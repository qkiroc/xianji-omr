"use client";
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
import { permanentDelete } from "../../shared/permanent-delete";
import { regionIssues } from "../../shared/region-issues";
import { songEditorTarget } from "../../shared/editor-navigation";
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
    savedBoxIds = useRef(new Set<string>()),
    deleteRequest = useRef<() => void>(() => {}),
    focusTarget = useRef<string | null>(null),
    pageDrag = useRef<{
      id: string;
      x: number;
      y: number;
      moved: boolean;
    } | null>(null),
    suppressPageClick = useRef(false);
  const { go } = useNavigation(),
    q = useSearchParams(),
    stage = useRef<HTMLDivElement>(null),
    canvas = useRef<AnnotationCanvas | null>(null),
    [doc, setDoc] = useState<LayoutDocument | null>(null),
    docRef = useRef(doc),
    [pages, setPages] = useState<PageImage[]>([]),
    [song, setSong] = useState<Song | null>(null),
    [songs, setSongs] = useState<Song[]>([]),
    [taxonomy, setTaxonomy] = useState<Category[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [currentClass, setCurrentClass] = useState("system"),
    classRef = useRef(currentClass),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [deleted, setDeleted] = useState(false),
    [zoom, setZoom] = useState(1),
    [mode, setMode] = useState("select"),
    [continuousDrawing, setContinuousDrawing] = useState(false),
    [history, setHistory] = useState({ undo: 0, redo: 0 }),
    [busy, setBusy] = useState(false),
    [imageRetry, setImageRetry] = useState(0);
  docRef.current = doc;
  classRef.current = currentClass;
  const view = q.get("view") || q.get("editorView") || "original",
    base = "/datasets/" + datasetId,
    selectedBox = doc?.boxes.find((b) => b.id === selected);
  const issues = regionIssues(doc?.boxes || []);
  const songIndex = songs.findIndex((s) => s.id === songId);
  const switchSong = (offset: number) => {
    const target = songs[songIndex + offset];
    if (target) go(songEditorTarget(datasetId, target, q.toString()));
  };
  const originalQuery = () =>
    useQueryString(new URLSearchParams(q), {
      view: undefined,
      editorView: undefined,
      box: undefined,
    });
  const loadPages = useCallback(async () => {
    if (!song) return;
    setPages(
      await api<PageImage[]>(
        "/v2/songs/" + song.id + "/pages" + (deleted ? "?deleted=deleted" : ""),
      ),
    );
  }, [song, deleted]);
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
        setSongs(ss);
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
            setPages(ps);
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
          savedBoxIds.current = new Set(value.boxes.map((b) => b.id));
          setSelected(null);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [datasetId, songId, pageId, song?.id]);
  useEffect(() => {
    void loadPages().catch((e) => setError(e.message));
  }, [loadPages]);
  useEffect(() => {
    if (!stage.current || !taxonomy.length) return;
    const c = new AnnotationCanvas(stage.current, {
      color: (key: string) =>
        taxonomy.find((c) => c.key === key)?.color || "#999",
      getClass: () => classRef.current,
      onRemoveRequest: () => deleteRequest.current(),
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
        setDoc((previous) => {
          if (!previous) return previous;
          const old = previous.boxes;
          const reviewed = mergeRegionReviews(
            previous.boxes,
            boxes,
            previous.image.status,
          ) as Box[];
          if (canvas.current) canvas.current.boxes = structuredClone(reviewed);
          const next = {
            ...previous,
            boxes: reviewed,
            deletedBoxes: [],
          };
          docRef.current = next;
          return next;
        });
        setDirty(true);
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
          const box = new URLSearchParams(window.location.search).get("box");
          if (box && canvas.current?.boxes.some((b: Box) => b.id === box)) {
            new URLSearchParams(window.location.search).get("view") === "crops"
              ? canvas.current.select(box)
              : canvas.current.focusRegion(box);
          }
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc?.image.id, taxonomy, imageRetry]);
  const save = useCallback(async () => {
    if (!docRef.current) return;
    setBusy(true);
    setError("");
    try {
      const current = docRef.current,
        result = await api<LayoutDocument>(
          "/v2/pages/" + current.image.id,
          json(
            {
              version: current.image.version,
              annotationFormat: "layout-v2",
              boxes: current.boxes,
              pageType: current.image.pageType,
            },
            "PUT",
          ),
        );
      savedBoxIds.current = new Set(result.boxes.map((b) => b.id));
      if (docRef.current === current) {
        setDoc(result);
        docRef.current = result;
        if (canvas.current)
          canvas.current.boxes = structuredClone(result.boxes);
        setDirty(false);
      } else if (docRef.current) {
        const pending = {
          ...docRef.current,
          image: {
            ...docRef.current.image,
            version: result.image.version,
            status: "draft" as const,
          },
        };
        setDoc(pending);
        docRef.current = pending;
        setDirty(true);
        throw Error(
          "前一版本已保存，但保存期间又有新修改；新修改仍在当前页面，请再次保存",
        );
      }
      await loadPages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      throw e;
    } finally {
      setBusy(false);
    }
  }, [loadPages]);
  useDirty(dirty, save);
  useEffect(() => {
    if (canvas.current) canvas.current.continuousDrawing = continuousDrawing;
  }, [continuousDrawing, taxonomy]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      if (document.querySelector(".modal-backdrop")) return;
      e.preventDefault();
      if (dirty && !busy && docRef.current) void save().catch(() => {});
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, busy, save]);
  const navigatePage = (p: PageImage) =>
    go(
      `${base}/songs/${p.songId}/pages/${p.id}?${useQueryString(new URLSearchParams(q), { box: undefined })}`,
    );
  const index = pages.findIndex((p) => p.id === pageId);
  const reorder = async (from: string, to: string) => {
    if (dirty) {
      setError("请先保存当前修改，再调整页序");
      return;
    }
    const order = [...pages],
      a = order.findIndex((p) => p.id === from),
      b = order.findIndex((p) => p.id === to);
    if (a < 0 || b < 0 || a === b) return;
    order.splice(b, 0, order.splice(a, 1)[0]);
    try {
      const result = await api<PageImage[]>(
        "/v2/songs/" + songId + "/pages/reorder",
        json({ items: order.map((p) => ({ id: p.id, version: p.version })) }),
      );
      setPages(result);
      setDoc((d) =>
        d
          ? {
              ...d,
              image: { ...d.image, ...result.find((p) => p.id === pageId) },
            }
          : d,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "排序失败");
      void loadPages();
    }
  };
  const changeBox = (fn: (b: Box) => void) =>
    canvas.current?.edit((boxes: Box[]) => {
      const b = boxes.find((b) => b.id === selected);
      if (b) {
        fn(b);
        b.reviewStatus = "draft";
      }
    });
  const confirmPage = async (unconfirm = false) => {
    try {
      if (
        !unconfirm &&
        !window.confirm("我已检查全部目标与漏标情况；负样本确实无目标。")
      )
        return;
      if (dirty) await save();
      const current = docRef.current!;
      const result = await api<LayoutDocument>(
        "/v2/pages/" +
          current.image.id +
          "/" +
          (unconfirm ? "unconfirm" : "confirm"),
        json({ version: current.image.version, acknowledged: true }),
      );
      setDoc(result);
      docRef.current = result;
      if (canvas.current) canvas.current.boxes = structuredClone(result.boxes);
      setDirty(false);
      await loadPages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败");
    }
  };
  const switchView = (v: string) =>
    go(
      `${base}/songs/${songId}/pages/${pageId}?${useQueryString(new URLSearchParams(q), { view: v })}`,
      true,
    ); // same-page view switches are handled below without leaving the document
  const viewOnly = (v: string) =>
    window.history.replaceState(
      { omrIndex: window.history.state?.omrIndex, omrReplace: true },
      "",
      `${base}/songs/${songId}/pages/${pageId}?${useQueryString(new URLSearchParams(q), { view: v })}`,
    );
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
  const upload = async (files: FileList | null) => {
    if (!files || !song) return;
    if (dirty) {
      setError("请先保存当前修改，再上传新页");
      return;
    }
    try {
      for (const file of Array.from(files))
        await api("/v2/songs/" + song.id + "/pages", {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        });
      await loadPages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    }
  };
  deleteRequest.current = () => {
    if (!selected || !docRef.current || busy) return;
    if (!savedBoxIds.current.has(selected)) {
      canvas.current?.removeLocal();
      if (canvas.current) {
        canvas.current.history = [];
        canvas.current.future = [];
        canvas.current.render();
      }
      return;
    }
    if (dirty) {
      setError("请先保存或撤销其他修改，再永久删除已保存区域");
      return;
    }
    const target = docRef.current.image.id,
      id = selected;
    setBusy(true);
    void (async () => {
      try {
        if (!(await permanentDelete("region", [target], [id]))) return;
        const value = await api<LayoutDocument>("/v2/pages/" + target);
        if (docRef.current?.image.id !== target) return;
        setDoc(value);
        docRef.current = value;
        savedBoxIds.current = new Set(value.boxes.map((b) => b.id));
        setDirty(false);
        if (canvas.current) {
          canvas.current.boxes = structuredClone(value.boxes);
          canvas.current.history = [];
          canvas.current.future = [];
          canvas.current.select(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "永久删除失败");
      } finally {
        setBusy(false);
      }
    })();
  };
  return (
    <>
      <div className="editor-toolbar">
        <div className="actions">
          <button onClick={() => go(base + "?" + originalQuery())}>
            ‹ 返回歌曲列表
          </button>
          <span className="editor-song-name" title={song?.name}>
            {song?.name}
          </span>
          <button
            title="按数据集歌曲顺序切换"
            aria-label="上一首歌曲"
            disabled={busy || songIndex <= 0}
            onClick={() => switchSong(-1)}
          >
            上一首
          </button>
          <button
            title="按数据集歌曲顺序切换"
            aria-label="下一首歌曲"
            disabled={busy || songIndex < 0 || songIndex >= songs.length - 1}
            onClick={() => switchSong(1)}
          >
            下一首
          </button>
        </div>
        <div className="actions">
          <button
            className={view === "original" ? "active" : ""}
            onClick={() => viewOnly("original")}
          >
            原图编辑
          </button>
          <button
            className={view === "crops" ? "active" : ""}
            onClick={() => viewOnly("crops")}
          >
            裁片结果
          </button>
        </div>
        <div className="actions">
          <span
            className={"save-status " + (dirty ? "unsaved" : "saved")}
            role="status"
          >
            {dirty
              ? "未保存"
              : doc?.image.status === "confirmed"
                ? "已确认"
                : "草稿"}
          </span>
          <button
            disabled={!doc || busy || !dirty}
            onClick={() => void save().catch(() => {})}
          >
            保存
          </button>
          <button
            disabled={!doc || busy}
            onClick={() => void confirmPage(true)}
          >
            取消确认
          </button>
          <button
            disabled={!doc || busy}
            className="primary"
            onClick={() => void confirmPage()}
          >
            确认本页
          </button>
        </div>
      </div>
      {!!issues.length && (
        <ErrorToast>
          <strong>{issues.length} 个区域的谱行关系有问题</strong>
          <span>红色 ! 为问题区域，橙色虚线为所属谱行；修正后自动消失。</span>
          {issues.map((issue) => (
            <span key={issue.boxId} className="actions">
              <button
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
              </button>
              {doc?.boxes.some(
                (b) => b.id === issue.parentId && b.classKey === "system",
              ) && (
                <button
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
                </button>
              )}
            </span>
          ))}
        </ErrorToast>
      )}
      <div className="tools" hidden={view === "crops"}>
        {["select", "draw", "pan"].map((m, i) => (
          <button
            key={m}
            className={mode === m ? "active" : ""}
            onClick={() => {
              setMode(m);
              canvas.current?.setMode(m);
            }}
          >
            {["选择 V", "画框 R", "平移 H"][i]}
          </button>
        ))}
        <label className="inline-check">
          <input
            type="checkbox"
            checked={continuousDrawing}
            onChange={(e) => setContinuousDrawing(e.target.checked)}
          />
          连续画框
        </label>
        <button
          disabled={!selected}
          onClick={() => {
            canvas.current?.setMode("select");
            canvas.current?.select(null);
          }}
        >
          显示全部框
        </button>
        <button onClick={() => canvas.current?.zoom(zoom / 1.25)}>−</button>
        <select
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
        </select>
        <button onClick={() => canvas.current?.zoom(zoom * 1.25)}>＋</button>
        <button onClick={() => canvas.current?.fit()}>适应</button>
        <button disabled={!history.undo} onClick={() => canvas.current?.undo()}>
          撤销
        </button>
        <button disabled={!history.redo} onClick={() => canvas.current?.redo()}>
          重做
        </button>
        <button disabled={!selected} onClick={() => canvas.current?.remove()}>
          删除框
        </button>
        <div className="spacer" />
        <button
          disabled={!doc}
          onClick={() => {
            if (doc) void downloadBackup(doc).catch((e) => setError(e.message));
          }}
        >
          导出本页JSON
        </button>
        <label style={{ margin: 0 }}>
          导入标注
          <input
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
      </div>
      <ErrorToast>
        {error}{" "}
        {error && doc && (
          <button
            onClick={() => {
              setError("");
              setImageRetry((n) => n + 1);
            }}
          >
            重试图片加载
          </button>
        )}
      </ErrorToast>
      <div className="editor-body" inert={busy}>
        <aside
          className="sidebar"
          onPointerMove={(e) => {
            const drag = pageDrag.current;
            if (!drag) return;
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
              drag.moved = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              e.preventDefault();
            }
          }}
          onPointerUp={(e) => {
            const drag = pageDrag.current;
            pageDrag.current = null;
            if (!drag?.moved) return;
            e.preventDefault();
            suppressPageClick.current = true;
            const target = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>("[data-page-id]");
            if (target?.dataset.pageId)
              void reorder(drag.id, target.dataset.pageId);
          }}
          onPointerCancel={() => {
            pageDrag.current = null;
          }}
          onClickCapture={(e) => {
            if (suppressPageClick.current) {
              e.preventDefault();
              e.stopPropagation();
              suppressPageClick.current = false;
            }
          }}
        >
          <h3>歌曲谱页</h3>
          <label>
            上传谱页
            <input
              type="file"
              aria-label="上传谱页"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => void upload(e.target.files)}
            />
          </label>
          <div className="actions">
            <button
              disabled={index <= 0}
              onClick={() => navigatePage(pages[index - 1])}
            >
              上一页
            </button>
            <button
              disabled={index < 0 || index >= pages.length - 1}
              onClick={() => navigatePage(pages[index + 1])}
            >
              下一页
            </button>
          </div>
          <select
            aria-label="谱页删除状态"
            value={String(deleted)}
            onChange={(e) => setDeleted(e.target.value === "true")}
          >
            <option value="false">使用中谱页</option>
            <option value="true">历史回收谱页</option>
          </select>
          {pages.map((p, i) => (
            <div
              key={p.id}
              data-page-id={p.id}
              draggable={false}
              onPointerDown={(e) => {
                suppressPageClick.current = false;
                if (
                  !deleted &&
                  e.button === 0 &&
                  !(e.target as Element).closest(".page-controls")
                )
                  pageDrag.current = {
                    id: p.id,
                    x: e.clientX,
                    y: e.clientY,
                    moved: false,
                  };
              }}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void reorder(e.dataTransfer.getData("text/plain"), p.id);
              }}
            >
              <button
                className={"page-button " + (p.id === pageId ? "active" : "")}
                disabled={deleted}
                onClick={() => navigatePage(p)}
              >
                ⠿ {p.pageOrder} · {p.name}
              </button>
              <div className="page-controls">
                {!deleted && (
                  <>
                    <button
                      disabled={!i}
                      onClick={() => void reorder(p.id, pages[i - 1].id)}
                    >
                      上移
                    </button>
                    <button
                      disabled={i === pages.length - 1}
                      onClick={() => void reorder(p.id, pages[i + 1].id)}
                    >
                      下移
                    </button>
                  </>
                )}
                <button
                  onClick={async () => {
                    if (dirty) {
                      setError("请先保存当前修改");
                      return;
                    }
                    try {
                      if (await permanentDelete("page", [p.id])) {
                        if (p.id === pageId) go(base + "?" + originalQuery());
                        else await loadPages();
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "删除失败");
                    }
                  }}
                >
                  永久删除
                </button>
              </div>
            </div>
          ))}
        </aside>
        <div
          className="stage-column"
          style={{ display: view === "crops" ? "none" : undefined }}
        >
          <div
            className="stage"
            ref={stage}
            tabIndex={0}
            aria-label="原图标注画布"
          >
            <canvas />
          </div>
          <div className="caption">
            {doc
              ? `${doc.image.width}×${doc.image.height} px · v${doc.image.version}`
              : "选择或上传谱页"}{" "}
            · {dirty ? "修改仅在当前页面" : "服务端已保存"} ·{" "}
            {mode === "draw"
              ? "拖动绘制区域"
              : mode === "pan"
                ? "拖动画布"
                : "拖动选中框 / 四角缩放"}{" "}
            · 空格拖动平移 · Ctrl/⌘滚轮缩放
          </div>
        </div>
        <aside className="properties" hidden={view === "crops"}>
          {!selectedBox && (
            <>
              <h3>新建框类别</h3>
              <p className="muted small">
                选择类别后，在原图拖出区域；已有框在下方属性中改类别。
              </p>
              <div className="category-grid">
                {taxonomy.map((c) => (
                  <button
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
                    {c.id} {c.name}
                  </button>
                ))}
              </div>
              <h3>区域列表 {doc?.boxes.length || 0}</h3>
              {selected && (
                <p className="muted small">当前只显示选中框 · Esc 显示全部</p>
              )}
              <div className="box-list">
                {doc?.boxes.map((b, i) => (
                  <button
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
                  </button>
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
              <button
                className="properties-back"
                onClick={() => canvas.current?.select(null)}
              >
                ‹ 返回页面配置
              </button>
              <label>
                类别
                <select
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
                </select>
              </label>
              <details className="advanced-properties">
                <summary>高级属性 · 谱行关联与坐标</summary>
                <label>
                  所属谱行
                  <select
                    aria-label="所属谱行"
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
                  </select>
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
                        <input
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
              </details>
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
            <label>
              页类型
              <select
                value={doc?.image.pageType || "music"}
                onChange={(e) => {
                  if (doc) {
                    setDoc({
                      ...doc,
                      image: {
                        ...doc.image,
                        pageType: e.target.value as "music" | "negative",
                      },
                    });
                    setDirty(true);
                  }
                }}
              >
                <option value="music">音乐页</option>
                <option value="negative">负样本（确无目标）</option>
              </select>
            </label>
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
        <textarea
          value={m.rawText || ""}
          onChange={(e) => change({ ...m, rawText: e.target.value })}
        />
      </label>
      <label>
        作用范围
        <select
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
        </select>
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
            <select
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
            </select>
          ) : (
            <input
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
