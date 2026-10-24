"use client";
import { App, Button as AntButton, Dropdown, Segmented, Spin, Tag, Tooltip } from "antd";
import { Details, Summary, Button, Input, Select, Textarea } from "../ui/antd";
import { ErrorToast } from "../ui/toast";
import { useRef, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  api,
  json,
  Box,
  Category,
  LayoutDocument,
  PageImage,
  Song,
  useQueryString,
} from "../../shared/client";
import { annotationChanged } from "../../shared/editor-document";
import {
  pageEditorTarget, pageTrailKey, readPageTrail, writePageTrail,
  reviewLabels, reviewQueue, reviewQueueQuery,
  type PageNeighbors, type PageTarget,
} from "../../shared/editor-navigation";
import { regionIssues } from "../../shared/region-issues";
import { AnnotationCanvas } from "./canvas";
import { useDirty, useNavigation } from "../navigation";
import { LayoutCrops } from "./results";
import { mergeRegionReviews, cropRectangle } from "../../server/src/crop-rules";
import { downloadBackup, importBackup } from "./backup";
const defaultCropState = { category: "", status: "", scroll: 0, size: 200 };
const meta = [
  "title",
  "performer",
  "time_signature",
  "key_signature",
  "tempo",
  "capo",
];
export function LayoutEditor({
  datasetId,
  songId,
  pageId,
}: {
  datasetId: string;
  songId: string;
  pageId?: string;
}) {
  const cropState = useRef({ ...defaultCropState }),
    savedDocument = useRef<LayoutDocument | null>(null),
    operation = useRef<"save" | "confirm" | "navigate" | null>(null),
    focusTarget = useRef<string | null>(null);
  const { message } = App.useApp();
  const { go, guard } = useNavigation(),
    q = useSearchParams(),
    stage = useRef<HTMLDivElement>(null),
    canvas = useRef<AnnotationCanvas | null>(null),
    [doc, setDoc] = useState<LayoutDocument | null>(null),
    docRef = useRef(doc),
    [song, setSong] = useState<Song | null>(null),
    [taxonomy, setTaxonomy] = useState<Category[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [currentClass, setCurrentClass] = useState("system"),
    classRef = useRef(currentClass),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1),
    [mode, setMode] = useState("select"),
    [continuousDrawing, setContinuousDrawing] = useState(false),
    [history, setHistory] = useState({ undo: 0, redo: 0 }),
    [busy, setBusy] = useState(false),
    [imageRetry, setImageRetry] = useState(0),
    [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading"),
    [neighbors, setNeighbors] = useState<PageNeighbors | null>(null),
    [trail, setTrail] = useState<PageTarget[]>([]);
  docRef.current = doc;
  classRef.current = currentClass;
  const view = q.get("view") || q.get("editorView") || "original",
    base = "/datasets/" + datasetId,
    selectedBox = doc?.boxes.find((b) => b.id === selected);
  const issues = regionIssues(doc?.boxes || []);
  const queue = doc ? reviewQueue(new URLSearchParams(q), doc.image) : q.get("queue") || q.get("status") || "",
    queueFilters = reviewQueueQuery(new URLSearchParams(q), queue).toString(),
    trailKey = pageTrailKey(datasetId, new URLSearchParams(q), queue);
  const getNeighbors = () => api<PageNeighbors>(
    `/v2/datasets/${datasetId}/pages/${pageId}/neighbors?${queueFilters}`,
  );
  useEffect(() => {
    if (!doc || doc.image.id !== pageId || !queue) return;
    let active = true;
    setNeighbors(null);
    void getNeighbors().then((value) => {
      if (active) setNeighbors(value);
    }).catch((e) => {
      if (active) setError(e.message);
    });
    return () => { active = false; };
  }, [datasetId, pageId, queueFilters, doc?.image.version]);
  useEffect(() => {
    if (!pageId) return;
    const items = readPageTrail(window.sessionStorage, trailKey);
    while (items.at(-1)?.id === pageId) items.pop();
    writePageTrail(window.sessionStorage, trailKey, items);
    setTrail(items);
  }, [trailKey, pageId]);
  const advance = async (direction: "previous" | "next", completedLabel?: string) => {
    const current = docRef.current;
    if (!current || current.image.id !== pageId) return;
    const items = readPageTrail(window.sessionStorage, trailKey);
    while (items.at(-1)?.id === pageId) items.pop();
    const fromTrail = direction === "previous" && items.length > 0;
    let target = fromTrail ? items.at(-1)! : null;
    if (!target) {
      const value = await getNeighbors();
      setNeighbors(value);
      target = direction === "previous" ? value.previousPage : value.nextPage;
    }
    if (!target) {
      void message.info(completedLabel
        ? `${completedLabel}，当前「${reviewLabels[queue] || "复核"}」队列已处理完成`
        : direction === "previous" ? "已经是第一张谱页" : "当前队列没有其他谱页");
      return;
    }
    go(pageEditorTarget(datasetId, target, new URLSearchParams(q), queue), false, () => {
      if (fromTrail) items.pop();
      else if (direction === "next") items.push({ id: current.image.id, songId: current.image.songId });
      writePageTrail(window.sessionStorage, trailKey, items);
      setTrail(items);
    });
  };
  const movePage = async (direction: "previous" | "next") => {
    if (operation.current) return;
    operation.current = "navigate";
    setBusy(true);
    try { await advance(direction); }
    catch (e) { setError(e instanceof Error ? e.message : "跳转失败"); }
    finally { operation.current = null; setBusy(false); }
  };
  const originalQuery = () =>
    useQueryString(new URLSearchParams(q), {
      view: undefined,
      editorView: undefined,
      box: undefined,
      queue: undefined,
    });
  useEffect(() => {
    let active = true;
    api<{ categories: Category[] }>("/v2/taxonomy")
      .then((t) => {
        if (active) setTaxonomy(t.categories);
      })
      .catch((e) => setError(e.message));
    api<Song[]>("/v2/datasets/" + datasetId + "/songs")
      .then((ss) => {
        if (!active) return;
        if (songId !== "resolve")
          setSong(ss.find((s) => s.id === songId) || null);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [datasetId, songId]);
  useEffect(() => {
    let active = true;
    setError("");
    setDoc(null);
    docRef.current = null;
    savedDocument.current = null;
    setImageState("loading");
    setHistory({ undo: 0, redo: 0 });
    setDirty(false);
    setSelected(null);
    if (canvas.current) {
      canvas.current.image = null;
      canvas.current.boxes = [];
      canvas.current.history = [];
      canvas.current.future = [];
      canvas.current.render();
    }
    if (!pageId) {
      if (song && song.id === songId) {
        api<PageImage[]>("/v2/songs/" + song.id + "/pages")
          .then((ps) => {
            if (!active) return;
            if (ps[0])
              go(`${base}/songs/${song.id}/pages/${ps[0].id}?${q}`, true);
          })
          .catch((e) => {
            if (active) setError(e.message);
          });
      }
      return () => {
        active = false;
      };
    }
    api<LayoutDocument>("/v2/pages/" + pageId)
      .then(async (value) => {
        if (!active) return;
        if (
          value.image.datasetId !== datasetId ||
          (songId !== "resolve" && value.image.songId !== songId)
        )
          throw Error("谱页不属于此歌曲/数据集");
        if (songId === "resolve") {
          go(`${base}/songs/${value.image.songId}/pages/${pageId}?${q}`, true);
          return;
        }
        if (!value.image.coordinate)
          value = await api<LayoutDocument>(
            "/v2/pages/" + pageId + "/normalize",
            json({ version: value.image.version }),
          );
        if (active) {
          setDoc(value);
          docRef.current = value;
          savedDocument.current = value;
          if (!q.get("queue")) {
            const params = new URLSearchParams(window.location.search);
            params.set("queue", reviewQueue(params, value.image));
            window.history.replaceState({ omrIndex: window.history.state?.omrIndex, omrReplace: true }, "",
              window.location.pathname + "?" + params);
          }
          setSelected(null);
        }
      })
      .catch((e) => {
        if (active) { setError(e.message); setImageState("error"); }
      });
    return () => {
      active = false;
    };
  }, [datasetId, songId, pageId, pageId ? undefined : song?.id]);
  useEffect(() => {
    if (!stage.current || !taxonomy.length) return;
    const c = new AnnotationCanvas(stage.current, {
      color: (key: string) =>
        taxonomy.find((c) => c.key === key)?.color || "#999",
      getClass: () => classRef.current,
      onSelect: (id: string | null) => {
        setSelected(id);
        const params = new URLSearchParams(window.location.search);
        if ((params.get("box") || null) !== id) {
          id ? params.set("box", id) : params.delete("box");
          window.history.replaceState(
            { omrIndex: window.history.state?.omrIndex, omrReplace: true },
            "",
            window.location.pathname + "?" + params,
          );
        }
      },
      onChange: (boxes: Box[]) => {
        const previous = docRef.current;
        if (!previous) return;
        const next = {
          ...previous,
          boxes: mergeRegionReviews(previous.boxes, boxes, previous.image.status) as Box[],
          deletedBoxes: [],
        };
        const changed = annotationChanged(savedDocument.current, next);
        if (!changed && savedDocument.current) next.boxes = structuredClone(savedDocument.current.boxes);
        c.boxes = structuredClone(next.boxes);
        docRef.current = next;
        setDoc(next);
        setDirty(changed);
      },
    });
    canvas.current = c;
    const listener = (e: Event) => {
      const d = (
        e as CustomEvent<{ scale: number; undo: number; redo: number }>
      ).detail;
      setZoom(d.scale);
      setHistory({ undo: d.undo, redo: d.redo });
    };
    const shortcut = (e: Event) => {
      setCurrentClass(
        taxonomy.find((c) => c.id === (e as CustomEvent<number>).detail)?.key ||
          "system",
      );
      c.setMode("draw");
    };
    const modeListener = (e: Event) =>
      setMode((e as CustomEvent<string>).detail);
    document.addEventListener("class-shortcut", shortcut);
    document.addEventListener("canvas-mode", modeListener);
    document.addEventListener("canvas-view", listener);
    return () => {
      document.removeEventListener("class-shortcut", shortcut);
      document.removeEventListener("canvas-mode", modeListener);
      document.removeEventListener("canvas-view", listener);
      c.dispose?.();
      canvas.current = null;
    };
  }, [taxonomy]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let active = true,
      url = "";
    setImageState("loading");
    canvas.current.image = null;
    canvas.current.render();
    fetch("/api/v2/pages/" + doc.image.id + "/content")
      .then(async (r) => {
        if (!r.ok) throw Error("工作图读取失败");
        url = URL.createObjectURL(await r.blob());
        if (active) {
          await canvas.current?.load(
            url,
            doc.boxes,
            doc.image.width,
            doc.image.height,
            () => active,
          );
          if (!active) return;
          setImageState("ready");
          const box = new URLSearchParams(window.location.search).get("box");
          if (box && canvas.current?.boxes.some((b: Box) => b.id === box)) {
            new URLSearchParams(window.location.search).get("view") === "crops"
              ? canvas.current.select(box)
              : canvas.current.focusRegion(box);
          }
        }
      })
      .catch((e) => {
        if (active) { setError(e.message); setImageState("error"); }
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc?.image.id, taxonomy, imageRetry]);
  const persist = useCallback(async () => {
    const current = docRef.current;
    if (!current) return;
    const result = await api<LayoutDocument>(
      "/v2/pages/" + current.image.id,
      json({
        version: current.image.version,
        annotationFormat: "layout-v2",
        boxes: current.boxes,
        pageType: current.image.pageType,
      }, "PUT"),
    );
    if (docRef.current?.image.id !== current.image.id) return;
    savedDocument.current = result;
    if (docRef.current !== current) {
      const pending = { ...docRef.current, image: { ...docRef.current.image,
        version: result.image.version, status: "draft" as const } };
      docRef.current = pending;
      setDoc(pending);
      setDirty(true);
      throw Error("已保存上一版本，新的修改仍在本页，请再次保存");
    }
    docRef.current = result;
    setDoc(result);
    setDirty(false);
    guard(null);
    if (canvas.current) {
      canvas.current.boxes = structuredClone(result.boxes);
      canvas.current.history = [];
      canvas.current.future = [];
      canvas.current.render();
    }
  }, [guard]);
  const save = useCallback(async () => {
    if (operation.current) throw Error("正在处理当前操作，请稍后重试");
    operation.current = "save";
    setBusy(true);
    setError("");
    try { await persist(); }
    catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      throw e;
    } finally { operation.current = null; setBusy(false); }
  }, [persist]);
  useDirty(dirty, save);
  useEffect(() => {
    if (canvas.current) canvas.current.continuousDrawing = continuousDrawing;
  }, [continuousDrawing, taxonomy]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      if (document.querySelector(".ant-modal-root")) return;
      e.preventDefault();
      if (dirty && !busy && docRef.current) void save().catch(() => {});
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, busy, save]);
  const changeBox = (fn: (b: Box) => void) =>
    canvas.current?.edit((boxes: Box[]) => {
      const b = boxes.find((b) => b.id === selected);
      if (b) {
        const wasSystem = b.classKey === "system";
        fn(b);
        if (wasSystem && b.classKey !== "system")
          for (const child of boxes)
            if (child.parentSystemId === b.id) child.parentSystemId = null;
        b.reviewStatus = "draft";
      }
    });
  const confirmPage = async (
    unconfirm = false,
    reviewType: "human" | "ai" = "human",
  ) => {
    if (operation.current || !docRef.current) return;
    operation.current = "confirm";
    setBusy(true);
    setError("");
    try {
      if (annotationChanged(savedDocument.current, docRef.current)) await persist();
      const current = docRef.current!;
      const result = await api<LayoutDocument>(
        "/v2/pages/" + current.image.id + "/" + (unconfirm ? "unconfirm" : "confirm"),
        json({ version: current.image.version, acknowledged: true, reviewType }),
      );
      if (docRef.current?.image.id !== current.image.id) return;
      setDoc(result);
      docRef.current = result;
      savedDocument.current = result;
      if (canvas.current) {
        canvas.current.boxes = structuredClone(result.boxes);
        canvas.current.history = [];
        canvas.current.future = [];
        canvas.current.render();
      }
      setDirty(false);
      guard(null);
      if (unconfirm) void message.success("已改为草稿");
      else {
        void message.success(reviewType === "ai" ? "已标记为 AI 已复核" : "本页已确认");
        // Confirmation succeeded even if the following navigation fails.
        const completedLabel = reviewType === "ai" ? "本页已标记为 AI 已复核" : "本页已确认";
        try { await advance("next", completedLabel); }
        catch (e) {
          setError(completedLabel + "，下一页加载失败：" + (e instanceof Error ? e.message : "请点击下一页重试"));
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : "确认失败"); }
    finally { operation.current = null; setBusy(false); }
  };
  // Next copies its router metadata for external history updates. Passing its
  // internal __NA/_N markers would skip notifying useSearchParams.
  const viewOnly = (v: string) =>
    window.history.replaceState(
      { omrIndex: window.history.state?.omrIndex, omrReplace: true },
      "",
      `${base}/songs/${songId}/pages/${pageId}?${useQueryString(new URLSearchParams(q), { view: v })}`,
    );
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey ||
          event.isComposing || event.defaultPrevented || busy) return;
      const target = event.target as Element | null;
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .ant-select, .ant-input-number, [role="dialog"]') ||
          document.querySelector('.ant-select [aria-expanded="true"], .ant-select[aria-expanded="true"]') ||
          [...document.querySelectorAll(".ant-modal-wrap")].some((dialog) => dialog.getClientRects().length > 0)) return;
      event.preventDefault();
      viewOnly(view === "original" ? "crops" : "original");
    };
    window.addEventListener("keydown", toggle, true);
    return () => window.removeEventListener("keydown", toggle, true);
  }, [view, busy, datasetId, songId, pageId, q]);
  useEffect(() => {
    if (view === "original")
      requestAnimationFrame(() => {
        if (focusTarget.current && canvas.current) {
          canvas.current.focusRegion(focusTarget.current);
          focusTarget.current = null;
        } else if (canvas.current && canvas.current.scale <= 0.01)
          canvas.current.fit();
      });
  }, [view]);
  return (
    <>
      <header className="editor-toolbar review-toolbar">
        <div className="editor-identity">
          <AntButton type="text" onClick={() => go(base + "?" + originalQuery())}>‹ 列表</AntButton>
          <div className="editor-page-heading">
            <Tooltip title={song?.name}><strong>{song?.name || "谱页标注"}</strong></Tooltip>
            <span className="muted small">
              {doc ? `第 ${doc.image.pageOrder} 页` : "加载中…"}
              {doc && song ? ` / 共 ${song.page_count} 页` : ""}
            </span>
          </div>
        </div>
        <div className="editor-view-switch">
          <Tooltip title="Tab 切换原图标注 / 裁片预览">
        <Segmented aria-label="编辑视图" value={view} onChange={(v) => viewOnly(String(v))}
          options={[{ label: "原图标注", value: "original" }, { label: "裁片预览", value: "crops" }]} />
          </Tooltip>
        </div>
        <div className="editor-save-actions">
          <span className={"save-status " + (dirty ? "unsaved" : "saved")} role="status">
            {dirty ? "未保存" : doc?.image.status === "confirmed" ? "已确认" :
              doc?.image.status === "ai_reviewed" ? "AI 已复核" : doc ? "已保存" : ""}
          </span>
          <AntButton disabled={!doc || busy || !dirty} loading={operation.current === "save"}
            onClick={() => void save().catch(() => {})}>保存</AntButton>
          <AntButton type="primary" disabled={!doc || busy || imageState !== "ready"}
            loading={operation.current === "confirm"} onClick={() => void confirmPage()}>
            确认并下一页
          </AntButton>
          <Dropdown trigger={["click"]} menu={{ items: [
            { key: "ai", label: "标记为 AI 已复核", disabled: !doc || busy,
              onClick: () => void confirmPage(false, "ai") },
            { key: "draft", label: "改为草稿", disabled: !doc || busy || doc.image.status === "draft",
              onClick: () => void confirmPage(true) },
          ] }}>
            <AntButton disabled={!doc || busy} aria-label="页面更多操作">•••</AntButton>
          </Dropdown>
        </div>
      </header>
      {!!issues.length && (
        <ErrorToast>
          <strong>{issues.length} 个区域的谱行关系有问题</strong>
          <span>红色 ! 为问题区域，橙色虚线为所属谱行；修正后自动消失。</span>
          {issues.map((issue) => (
            <span key={issue.boxId} className="actions">
              <Button
                title={issue.message}
                onClick={() => {
                  if (view === "original")
                    canvas.current?.focusRegion(issue.boxId);
                  else {
                    focusTarget.current = issue.boxId;
                    viewOnly("original");
                  }
                }}
              >
                定位区域{" "}
                {(doc?.boxes.findIndex((b) => b.id === issue.boxId) ?? -1) + 1}
              </Button>
              {doc?.boxes.some(
                (b) => b.id === issue.parentId && b.classKey === "system",
              ) && (
                <Button
                  onClick={() => {
                    if (view === "original")
                      canvas.current?.focusRegion(issue.parentId);
                    else {
                      focusTarget.current = issue.parentId;
                      viewOnly("original");
                    }
                  }}
                >
                  调整所属谱行
                </Button>
              )}
            </span>
          ))}
        </ErrorToast>
      )}
      <div className="tools review-tools">
        <div className="editor-page-navigation">
          <AntButton disabled={busy || !doc || (!trail.length && !neighbors?.previousPage)}
            onClick={() => void movePage("previous")}>‹ 上一页</AntButton>
          <Tag className="queue-label">{reviewLabels[queue] || "复核"}队列</Tag>
          <AntButton disabled={busy || !doc || (neighbors !== null && !neighbors.nextPage)}
            onClick={() => void movePage("next")}>下一页 ›</AntButton>
        </div>
        <div className="canvas-tools" hidden={view === "crops"} inert={busy || imageState !== "ready"}>
        {["select", "draw", "pan"].map((m, i) => (
          <Button
            key={m}
            title={["选择 V", "画框 R", "平移 H"][i]}
            className={mode === m ? "active" : ""}
            onClick={() => {
              setMode(m);
              canvas.current?.setMode(m);
            }}
          >
            {["选择", "画框", "平移"][i]}
          </Button>
        ))}
        <label className="inline-check">
          <Input
            type="checkbox"
            checked={continuousDrawing}
            onChange={(e) => setContinuousDrawing(e.target.checked)}
          />
          连续画框
        </label>
        <Button
          disabled={!selected}
          onClick={() => {
            canvas.current?.setMode("select");
            canvas.current?.select(null);
          }}
        >
          显示全部框
        </Button>
        <Button onClick={() => canvas.current?.zoom(zoom / 1.25)}>−</Button>
        <Select
          aria-label="视图缩放"
          value={zoom}
          onChange={(e) => canvas.current?.zoom(Number(e.target.value))}
        >
          {[...new Set([0.25, 0.5, 1, 2, 4, zoom])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option value={n} key={n}>
                {Math.round(n * 100)}%
              </option>
            ))}
        </Select>
        <Button onClick={() => canvas.current?.zoom(zoom * 1.25)}>＋</Button>
        <Button onClick={() => canvas.current?.fit()}>适应</Button>
        <Button title="撤销未保存的编辑 Ctrl/⌘ Z" disabled={!history.undo} onClick={() => canvas.current?.undo()}>
          撤销
        </Button>
        <Button title="重做 Ctrl/⌘ Shift Z" disabled={!history.redo} onClick={() => canvas.current?.redo()}>
          重做
        </Button>
        <Button className="danger" title="删除选区 Delete / Backspace，可撤销" disabled={!selected} onClick={() => canvas.current?.remove()}>
          删除框
        </Button>
        </div>
      </div>
      <ErrorToast>{error}</ErrorToast>
      <div className="editor-body single-page-editor" inert={busy}>
        <div
          className="stage-column"
          style={{ display: view === "crops" ? "none" : undefined }}
        >
          <div className="stage-wrap">
          <div
            className="stage"
            ref={stage}
            tabIndex={0}
            aria-label="原图标注画布"
          >
            <canvas />
          </div>
          {imageState === "loading" && <div className="canvas-loading"><Spin /><span>正在加载谱页…</span></div>}
          {imageState === "error" && <div className="canvas-loading">
            <span>谱页加载失败</span>
            <AntButton onClick={() => doc ? setImageRetry((n) => n + 1) : window.location.reload()}>重新加载</AntButton>
          </div>}
          </div>
          <div className="caption">
            <span>{doc ? `${doc.image.width} × ${doc.image.height} px · ${doc.boxes.length} 个区域` : "加载中…"}</span>
            <span>空格拖动平移 · Ctrl/⌘ 滚轮缩放 · Esc 取消选择</span>
          </div>
        </div>
        <aside className="properties" hidden={view === "crops"} inert={imageState !== "ready"}>
          {!selectedBox && (
            <>
              <h3>添加区域</h3>
              <p className="muted small">选择类别，在原图上拖动画框</p>
              <div className="category-grid">
                {taxonomy.map((c) => (
                  <Button
                    key={c.key}
                    style={{
                      color: c.color,
                      borderColor: currentClass === c.key ? c.color : undefined,
                      background:
                        currentClass === c.key ? c.color + "14" : undefined,
                    }}
                    className={
                      currentClass === c.key ? "category-selected" : ""
                    }
                    onClick={() => {
                      setCurrentClass(c.key);
                      classRef.current = c.key;
                      canvas.current?.setMode("draw");
                      canvas.current?.select(null);
                    }}
                  >
                    <span
                      className="category-dot"
                      style={{ background: c.color }}
                    />
                    {c.name}
                  </Button>
                ))}
              </div>
              <h3 className="properties-section-title">全部区域 <span>{doc?.boxes.length || 0}</span></h3>
              {!doc?.boxes.length && <p className="muted small">还没有区域，选择上方类别开始标注。</p>}
              {selected && (
                <p className="muted small">当前只显示选中框 · Esc 显示全部</p>
              )}
              <div className="box-list">
                {doc?.boxes.map((b, i) => (
                  <Button
                    key={b.id}
                    className={
                      (b.id === selected ? "active " : "") +
                      (issues.some((issue) => issue.boxId === b.id)
                        ? "region-invalid"
                        : "")
                    }
                    style={{
                      color: taxonomy.find((c) => c.key === b.classKey)?.color,
                    }}
                    title={
                      issues.find((issue) => issue.boxId === b.id)?.message
                    }
                    onClick={() => {
                      canvas.current?.setMode("select");
                      canvas.current?.focusRegion(b.id);
                    }}
                  >
                    {issues.some((issue) => issue.boxId === b.id) ? "⚠ " : ""}
                    {i + 1} ·{" "}
                    {taxonomy.find((c) => c.key === b.classKey)?.name ||
                      "历史未归类"}{" "}
                    · {b.width}×{b.height}
                  </Button>
                ))}
              </div>
              {!selectedBox && (
                <p className="muted small">
                  点击画布或区域列表选中一个框，再调整位置、大小与属性。
                </p>
              )}
            </>
          )}
          {selectedBox && (
            <>
              <h3
                className="selected-region-title"
                style={{
                  color: taxonomy.find((c) => c.key === selectedBox.classKey)
                    ?.color,
                }}
              >
                <span
                  className="category-dot"
                  style={{
                    background: taxonomy.find(
                      (c) => c.key === selectedBox.classKey,
                    )?.color,
                  }}
                />
                区域{" "}
                {(doc?.boxes.findIndex((b) => b.id === selectedBox.id) ?? -1) +
                  1}
              </h3>
              <Button
                className="properties-back"
                onClick={() => canvas.current?.select(null)}
              >
                ‹ 全部区域 · Esc
              </Button>
              <label>
                类别
                <Select
                  style={{
                    color: taxonomy.find((c) => c.key === selectedBox.classKey)
                      ?.color,
                    borderColor: taxonomy.find(
                      (c) => c.key === selectedBox.classKey,
                    )?.color,
                  }}
                  aria-label="选中框类别"
                  value={selectedBox.classKey || ""}
                  onChange={(e) =>
                    changeBox((b) => {
                      b.classKey = e.target.value || null;
                      if (meta.includes(b.classKey || "")) {
                        b.metadata = { scope: "page" };
                        b.parentSystemId = null;
                      } else delete b.metadata;
                      if (b.classKey === "system") b.parentSystemId = null;
                    })
                  }
                >
                  <option value="">历史未归类</option>
                  {taxonomy.map((c) => (
                    <option
                      style={{ color: c.color }}
                      value={c.key}
                      key={c.key}
                    >
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Details className="advanced-properties">
                <Summary>高级属性 · 谱行关联与坐标</Summary>
                <label>
                  所属谱行
                  <Select
                    aria-label="所属谱行"
                    disabled={selectedBox.classKey === "system" || (meta.includes(selectedBox.classKey || "") && selectedBox.metadata?.scope !== "local")}
                    value={selectedBox.parentSystemId || ""}
                    onChange={(e) =>
                      changeBox((b) => {
                        b.parentSystemId = e.target.value || null;
                      })
                    }
                  >
                    <option value="">无父谱行</option>
                    {doc?.boxes
                      .filter(
                        (b) =>
                          b.classKey === "system" && b.id !== selectedBox.id,
                      )
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          谱行{" "}
                          {doc!.boxes
                            .filter((x) => x.classKey === "system")
                            .findIndex((x) => x.id === b.id) + 1}{" "}
                          · {b.x}, {b.y}
                        </option>
                      ))}
                  </Select>
                </label>
                <div className="coordinates">
                  {(["x", "y", "width", "height", "readingOrder"] as const).map(
                    (key) => (
                      <label key={key}>
                        {
                          {
                            x: "左侧 X",
                            y: "顶部 Y",
                            width: "宽度",
                            height: "高度",
                            readingOrder: "阅读顺序",
                          }[key]
                        }
                        <Input
                          aria-label={key}
                          type="number"
                          step={1}
                          value={selectedBox[key]}
                          onChange={(e) =>
                            changeBox((b) => {
                              b[key] = Number(e.target.value);
                              if (key !== "readingOrder" && doc) {
                                b.x = Math.max(
                                  0,
                                  Math.min(b.x, doc.image.width - 1),
                                );
                                b.y = Math.max(
                                  0,
                                  Math.min(b.y, doc.image.height - 1),
                                );
                                b.width = Math.max(
                                  1,
                                  Math.min(b.width, doc.image.width - b.x),
                                );
                                b.height = Math.max(
                                  1,
                                  Math.min(b.height, doc.image.height - b.y),
                                );
                              }
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
              </Details>
              {meta.includes(selectedBox.classKey || "") && (
                <MetadataFields
                  box={selectedBox}
                  change={(m) =>
                    changeBox((b) => {
                      b.metadata = m;
                      if (m.scope !== "local") b.parentSystemId = null;
                    })
                  }
                />
              )}
            </>
          )}
          {!selectedBox && (
            <div className="page-settings">
            <label>
              页面内容
              <Select
                value={doc?.image.pageType || "music"}
                onChange={(e) => {
                  if (doc) {
                    const next = { ...doc, image: {
                      ...doc.image, pageType: e.target.value as "music" | "negative",
                    } };
                    docRef.current = next;
                    setDoc(next);
                    setDirty(annotationChanged(savedDocument.current, next));
                  }
                }}
              >
                <option value="music">音乐页</option>
                <option value="negative">负样本（确无目标）</option>
              </Select>
            </label>
            <Details className="backup-controls">
              <Summary>导入 / 导出标注</Summary>
        <Button
          disabled={!doc}
          onClick={() => {
            if (doc) void downloadBackup(doc).catch((e) => setError(e.message));
          }}
        >
          导出本页JSON
        </Button>
        <label style={{ margin: 0 }}>
          导入标注
          <Input
            type="file"
            aria-label="导入标注JSON"
            accept="application/json"
            onChange={async (e) => {
              const input = e.currentTarget,
                file = input.files?.[0];
              input.value = "";
              if (!file || !doc) return;
              try {
                if (file.size > 32 * 1024 * 1024)
                  throw Error("JSON备份超过32MiB");
                const raw = JSON.parse(await file.text()) as Record<
                  string,
                  unknown
                >;
                if (
                  raw.dataUrl ||
                  (raw.image as { dataUrl?: string } | undefined)?.dataUrl
                ) {
                  if (dirty)
                    throw Error("请先保存或放弃当前修改，再将备份导入为新页");
                  const imported = await importBackup(raw, songId);
                  go(
                    `${base}/songs/${songId}/pages/${imported.image.id}?view=original`,
                  );
                  return;
                }
                if (!raw || typeof raw !== "object" || Array.isArray(raw))
                  throw Error("JSON必须是对象");
                const annotation = raw as unknown as LayoutDocument;
                if (annotation.image?.id !== doc.image.id)
                  throw Error(
                    "请选择当前原图的标注JSON；导入为新页需包含dataUrl",
                  );
                if (!Array.isArray(annotation.boxes)) throw Error("缺少boxes");
                for (const box of annotation.boxes)
                  cropRectangle(box, doc.image.width, doc.image.height);
                canvas.current?.edit((boxes: Box[]) =>
                  boxes.splice(0, boxes.length, ...annotation.boxes),
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "导入失败");
              }
            }}
          />
        </label>
            </Details>
            </div>
          )}
        </aside>
        {doc && view === "crops" && (
          <LayoutCrops
            stateRef={cropState}
            doc={doc}
            image={canvas.current?.image as HTMLImageElement | undefined}
            taxonomy={taxonomy}
            dirty={dirty}
            onAdjust={(id) => {
              focusTarget.current = id;
              viewOnly("original");
            }}
          />
        )}
      </div>
    </>
  );
}
function MetadataFields({
  box,
  change,
}: {
  box: Box;
  change: (m: NonNullable<Box["metadata"]>) => void;
}) {
  const m = box.metadata || { scope: "page" },
    values = m.value || {},
    fields: Record<string, string[]> = {
      title: ["text"],
      performer: ["name"],
      time_signature: ["numerator", "denominator"],
      key_signature: ["kind", "tonic"],
      tempo: ["bpm", "beatUnit", "dotted"],
      capo: ["fret"],
    };
  return (
    <section>
      <h3>元信息（均可留空）</h3>
      <label>
        完整原文
        <Textarea
          value={m.rawText || ""}
          onChange={(e) => change({ ...m, rawText: e.target.value })}
        />
      </label>
      <label>
        作用范围
        <Select
          value={m.scope}
          onChange={(e) =>
            change({ ...m, scope: e.target.value as typeof m.scope })
          }
        >
          <option value="page">本页出现</option>
          <option value="global">曲目/谱本全局</option>
          {["tempo", "key_signature", "time_signature"].includes(
            box.classKey || "",
          ) && <option value="local">局部变化</option>}
        </Select>
      </label>
      {(fields[box.classKey || ""] || []).map((key) => (
        <label key={key}>
          {
            (
              {
                text: "标题",
                name: "演唱者姓名",
                numerator: "拍号分子",
                denominator: "拍号分母",
                kind: "调性类型 original/written/play",
                tonic: "调性",
                bpm: "BPM",
                beatUnit: "音符拍单位 1/2/4/8/16/32/64",
                dotted: "附点",
                fret: "变调夹品位（未注明留空，不夹0）",
              } as Record<string, string>
            )[key]
          }
          {key === "dotted" ? (
            <Select
              value={values[key] === undefined ? "" : String(values[key])}
              onChange={(e) => {
                const value = { ...values };
                if (!e.target.value) delete value[key];
                else value[key] = e.target.value === "true";
                change({ ...m, value });
              }}
            >
              <option value="">未注明</option>
              <option value="true">有附点</option>
              <option value="false">无附点</option>
            </Select>
          ) : (
            <Input
              value={values[key] === undefined ? "" : String(values[key])}
              type={
                [
                  "bpm",
                  "beatUnit",
                  "fret",
                  "numerator",
                  "denominator",
                ].includes(key)
                  ? "number"
                  : "text"
              }
              step={key === "bpm" ? "any" : 1}
              onChange={(e) => {
                const value = { ...values };
                if (e.target.value === "") delete value[key];
                else
                  value[key] = [
                    "bpm",
                    "beatUnit",
                    "fret",
                    "numerator",
                    "denominator",
                  ].includes(key)
                    ? Number(e.target.value)
                    : e.target.value;
                if (box.classKey === "performer" && Object.keys(value).length)
                  value.role = "performer";
                change({ ...m, value });
              }}
            />
          )}
        </label>
      ))}
    </section>
  );
}
