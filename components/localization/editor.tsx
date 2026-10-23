"use client";
import { ErrorToast } from "../ui/toast";
import {
  translateMeasure,
  originalBounds,
} from "../../shared/localization-edit";
import { clientId } from "../../shared/client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type {
  LocalizationRecord,
  Geometry,
  Measure,
  LocEvent,
  XYXY,
} from "../../shared/localization";
import {
  api,
  json,
  clone,
  useQueryString,
  PageResult,
  LayoutDocument,
} from "../../shared/client";
import { useNavigation, useDirty } from "../navigation";
type Mode = "select" | "measure" | "event" | "staff";
type Gesture = {
  kind: string;
  mid: string;
  eid?: string;
  line?: number;
  corner?: number;
  x: number;
  y: number;
  before: Geometry;
};
const id = () => clientId();
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function Preview({ src, box }: { src: string; box: XYXY | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.width = ref.current.height = 0;
    setError("");
    if (!box || !src) return;
    const image = new Image();
    image.src = src;
    let active = true;
    image.onload = () => {
      if (!active || !ref.current) return;
      if (
        !box.every(Number.isSafeInteger) ||
        box[0] < 0 ||
        box[1] < 0 ||
        box[2] <= box[0] ||
        box[3] <= box[1] ||
        box[2] > image.naturalWidth ||
        box[3] > image.naturalHeight
      ) {
        setError("裁片越界、尺寸为零或不是整数原图坐标");
        return;
      }
      const [x, y, r, b] = box,
        w = r - x,
        h = b - y,
        scale = Math.min(1, 600 / w, 180 / h),
        canvas = ref.current;
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas
        .getContext("2d")
        ?.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
    };
    image.onerror = () => {
      if (active) setError("裁片图片加载失败，请重试");
    };
    return () => {
      active = false;
    };
  }, [src, box, attempt]);
  return (
    <>
      <canvas
        ref={ref}
        hidden={!!error || !box}
        style={{ maxWidth: "100%", height: "auto", display: "block" }}
      />
      {error && (
        <ErrorToast>
          {error}
          <button onClick={() => setAttempt((n) => n + 1)}>重试裁片</button>
        </ErrorToast>
      )}
      {!box && <p className="muted">几何/裁片范围尚未标记</p>}
    </>
  );
}
export function LocalizationEditor({
  datasetId,
  recordId,
}: {
  datasetId: string;
  recordId: string;
}) {
  const { go } = useNavigation(),
    q = useSearchParams(),
    [record, setRecord] = useState<LocalizationRecord | null>(null),
    [geometry, setGeometry] = useState<Geometry | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mode, setMode] = useState<Mode>("select"),
    [image, setImage] = useState(""),
    [zoom, setZoom] = useState(1),
    [showSource, setShowSource] = useState(false),
    [measureId, setMeasureId] = useState(q.get("measure") || ""),
    [eventId, setEventId] = useState(q.get("event") || ""),
    [pageId, setPageId] = useState(q.get("sourcePage") || ""),
    [history, setHistory] = useState<Geometry[]>([]),
    [future, setFuture] = useState<Geometry[]>([]),
    [staffClicks, setStaffClicks] = useState<number[]>([]),
    [retry, setRetry] = useState(0),
    [systemContext, setSystemContext] = useState<XYXY | null>(null);
  const recordRef = useRef(record);
  recordRef.current = record;
  const current = useRef(geometry),
    gesture = useRef<Gesture | null>(null);
  current.current = geometry;
  const saveRef = useRef<() => Promise<void>>(async () => {}),
    base = "/localization/datasets/" + datasetId,
    measure = geometry?.measures.find((m) => m.id === measureId),
    event = measure?.events.find((e) => e.id === eventId),
    page =
      geometry?.pages.find((p) => p.localPageId === pageId) ||
      geometry?.pages[0];
  useEffect(() => {
    let active = true;
    api<LocalizationRecord>("/v2/localization/records/" + recordId)
      .then((r) => {
        if (!active) return;
        if (r.dataset_id !== datasetId) throw Error("记录不属于此定位数据集");
        setRecord(r);
        setGeometry(r.geometry);
        setPageId(
          q.get("sourcePage") || r.geometry.pages[0]?.localPageId || "",
        );
        setMeasureId(q.get("measure") || r.geometry.measures[0]?.id || "");
        setDirty(false);
        setHistory([]);
        setFuture([]);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [recordId, datasetId]);
  useEffect(() => {
    if (!page) return;
    let alive = true,
      url = "";
    setImage("");
    fetch("/api/v2/localization/sources/" + page.sourcePageId + "/content", {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw Error("来源图片加载失败或SHA不匹配");
        url = URL.createObjectURL(await r.blob());
        if (alive) setImage(url);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [page?.sourcePageId, retry]);
  useEffect(() => {
    setSystemContext(null);
    if (!page || !measure?.systemId) return;
    let active = true;
    api<LayoutDocument>("/v2/pages/" + page.sourcePageId)
      .then((doc) => {
        const box = doc.boxes.find(
          (b) => b.id === measure.systemId && b.classKey === "system",
        );
        const c = doc.image.coordinate as {
          version?: string;
          orientation?: number;
        } | null;
        if (
          box &&
          active &&
          c?.version === "pixel-v1" &&
          typeof c.orientation === "number"
        )
          setSystemContext(
            originalBounds(box, c.orientation, page.width, page.height),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [page?.sourcePageId, measure?.systemId]);
  const location = (changes: Record<string, string | undefined>) => {
    const query = useQueryString(
      new URLSearchParams(locationSearch()),
      changes,
    );
    window.history.replaceState(
      { omrIndex: window.history.state?.omrIndex, omrReplace: true },
      "",
      window.location.pathname + "?" + query,
    );
  };
  function locationSearch() {
    return window.location.search;
  }
  const selectMeasure = (m: Measure) => {
    setMeasureId(m.id);
    setEventId("");
    setPageId(m.pageId);
    location({ measure: m.id, event: undefined, sourcePage: m.pageId });
  };
  const selectEvent = (m: Measure, e: LocEvent) => {
    setMeasureId(m.id);
    setEventId(e.id);
    setPageId(m.pageId);
    location({ measure: m.id, event: e.id, sourcePage: m.pageId });
  };
  const commit = useCallback((next: Geometry, before = current.current) => {
    if (!before || same(next, before)) return;
    for (const m of next.measures) {
      const prev = before.measures.find((x) => x.id === m.id);
      if (
        !prev ||
        !same(
          { ...m, geometryConfirmed: false, completenessConfirmed: false },
          { ...prev, geometryConfirmed: false, completenessConfirmed: false },
        )
      ) {
        m.geometryConfirmed = false;
        m.completenessConfirmed = false;
      }
    }
    setHistory((h) => [...h.slice(-99), clone(before)]);
    setFuture([]);
    setGeometry(next);
    current.current = next;
    setDirty(true);
  }, []);
  const edit = (fn: (g: Geometry) => void) => {
    if (!current.current) return;
    const next = clone(current.current);
    fn(next);
    commit(next);
  };
  const save = useCallback(async () => {
    if (!record || !current.current) return;
    setError("");
    setBusy(true);
    try {
      const before = current.current;
      const result = await api<LocalizationRecord>(
        "/v2/localization/records/" + record.id,
        json({ version: record.version, geometry: before }, "PUT"),
      );
      setRecord(result);
      recordRef.current = result;
      if (current.current === before) {
        setGeometry(result.geometry);
        current.current = result.geometry;
        setDirty(false);
      } else {
        setDirty(true);
        throw Error("前一版本已保存，但新的修改仍未保存，请再次保存");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      throw e;
    } finally {
      setBusy(false);
    }
  }, [record]);
  saveRef.current = save;
  useDirty(dirty, save);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      if (document.querySelector(".modal-backdrop")) return;
      e.preventDefault();
      if (dirty && !busy && recordRef.current) void save().catch(() => {});
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, busy, save]);
  const undo = (redo = false) => {
    const stack = redo ? future : history;
    if (!stack.length || !geometry) return;
    const next = clone(stack[stack.length - 1]);
    if (redo) {
      setFuture((f) => f.slice(0, -1));
      setHistory((h) => [...h, clone(geometry)]);
    } else {
      setHistory((h) => h.slice(0, -1));
      setFuture((f) => [...f, clone(geometry)]);
    }
    for (const m of next.measures) {
      const previous = geometry.measures.find((v) => v.id === m.id);
      if (!same(m, previous)) {
        m.geometryConfirmed = m.completenessConfirmed = false;
      }
    }
    setGeometry(next);
    current.current = next;
    setDirty(true);
  };
  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(page!.width, ((e.clientX - r.left) / r.width) * page!.width),
      ),
      y: Math.max(
        0,
        Math.min(page!.height, ((e.clientY - r.top) / r.height) * page!.height),
      ),
    };
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geometry || !page) return;
    const p = point(e),
      target = (e.target as Element).closest("[data-kind]"),
      kind = target?.getAttribute("data-kind");
    if (mode === "staff" && measure) {
      const values = [...staffClicks, p.y];
      setStaffClicks(values);
      if (values.length === 6) {
        edit((g) => {
          g.measures.find((m) => m.id === measure.id)!.staffLines = values;
        });
        setMode("select");
        setStaffClicks([]);
      }
      return;
    }
    if (mode === "event" && measure) {
      const ev: LocEvent = {
        id: id(),
        voice: measure.voice,
        centerX: p.x,
        bbox: null,
        contextBBox: null,
        status: "candidate",
        evidence: {},
        annotationSource: { kind: "manual_geometry", observed: true },
        confidence: null,
      };
      edit((g) => g.measures.find((m) => m.id === measure.id)!.events.push(ev));
      setEventId(ev.id);
      location({ event: ev.id });
      return;
    }
    if (mode === "measure") {
      const mid = id(),
        m: Measure = {
          id: mid,
          pageId: page.localPageId,
          systemId: null,
          barNumber: null,
          track: "guitar",
          voice: "1",
          bbox: [
            Math.floor(p.x),
            Math.floor(p.y),
            Math.floor(p.x),
            Math.floor(p.y),
          ],
          staffLines: null,
          events: [],
          geometryConfirmed: false,
          completenessConfirmed: false,
          reviewNote: "",
        };
      const next = clone(geometry);
      next.measures.push(m);
      gesture.current = {
        kind: "draw",
        mid,
        x: p.x,
        y: p.y,
        before: clone(geometry),
      };
      setGeometry(next);
      current.current = next;
      setMeasureId(mid);
      setEventId("");
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (target && kind) {
      const mid = target.getAttribute("data-measure")!,
        m = geometry.measures.find((m) => m.id === mid);
      if (!m) return;
      setMeasureId(mid);
      const eid = target.getAttribute("data-event") || undefined;
      if (eid) setEventId(eid);
      gesture.current = {
        kind,
        mid,
        eid,
        line: Number(target.getAttribute("data-line") || 0),
        corner: Number(target.getAttribute("data-corner") || 0),
        x: p.x,
        y: p.y,
        before: clone(geometry),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || !page) return;
    const p = point(e),
      next = clone(g.before);
    if (g.kind === "draw")
      next.measures.push({
        id: g.mid,
        pageId: page.localPageId,
        systemId: null,
        barNumber: null,
        track: "guitar",
        voice: "1",
        bbox: [
          Math.floor(Math.min(g.x, p.x)),
          Math.floor(Math.min(g.y, p.y)),
          Math.ceil(Math.max(g.x, p.x)),
          Math.ceil(Math.max(g.y, p.y)),
        ],
        staffLines: null,
        events: [],
        geometryConfirmed: false,
        completenessConfirmed: false,
        reviewNote: "",
      });
    else {
      const m = next.measures.find((m) => m.id === g.mid)!;
      if (g.kind === "event") {
        m.events.find((e) => e.id === g.eid)!.centerX =
          Math.round(p.x * 1000) / 1000;
      } else if (g.kind === "staff" && m.staffLines)
        m.staffLines[g.line!] = Math.round(p.y * 1000) / 1000;
      else if (m.bbox) {
        const b = m.bbox,
          dx = Math.round(p.x - g.x),
          dy = Math.round(p.y - g.y);
        if (g.kind === "measure") {
          translateMeasure(m, dx, dy, page.width, page.height);
        } else if (g.kind === "corner") {
          const c = g.corner!;
          b[c === 0 || c === 3 ? 0 : 2] = Math.round(p.x);
          b[c < 2 ? 1 : 3] = Math.round(p.y);
          m.bbox = [
            Math.min(b[0], b[2]),
            Math.min(b[1], b[3]),
            Math.max(b[0], b[2]),
            Math.max(b[1], b[3]),
          ];
        }
      }
      m.geometryConfirmed = m.completenessConfirmed = false;
    }
    setGeometry(next);
    current.current = next;
  };
  const finish = () => {
    const g = gesture.current;
    if (!g || !current.current) return;
    gesture.current = null;
    const next = current.current;
    const m = next.measures.find((m) => m.id === g.mid);
    if (
      g.kind === "draw" &&
      (!m?.bbox || m.bbox[0] === m.bbox[2] || m.bbox[1] === m.bbox[3])
    ) {
      setGeometry(g.before);
      current.current = g.before;
      return;
    }
    commit(next, g.before);
    if (g.kind === "draw") setMode("select");
    location({ measure: g.mid, event: g.eid });
  };
  const command = async (kind: "confirm" | "unconfirm") => {
    try {
      if (
        kind === "confirm" &&
        !window.confirm(
          "我已检查全部小节/事件几何、六弦线与人工完整性。几何确认不等于内容真值。",
        )
      )
        return;
      if (dirty) await save();
      const latest = recordRef.current!;
      const value = await api<LocalizationRecord>(
        "/v2/localization/records/" + recordId + "/" + kind,
        json({ version: latest.version, acknowledged: true }),
      );
      setRecord(value);
      recordRef.current = value;
      setGeometry(value.geometry);
      current.current = value.geometry;
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败");
    }
  };
  const reject = async (restore = false) => {
    if (!event) return;
    try {
      if (dirty) await save();
      const latest = recordRef.current!;
      const result = await api<LocalizationRecord>(
        "/v2/localization/records/" +
          recordId +
          "/events/" +
          encodeURIComponent(event.id) +
          "/" +
          (restore ? "restore" : "reject"),
        json({ version: latest.version }),
      );
      setRecord(result);
      setGeometry(result.geometry);
      current.current = result.geometry;
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  };
  if (!record || !geometry)
    return (
      <>
        <ErrorToast>{error}</ErrorToast>
        <p className="muted">
          {error ? "定位记录加载失败，请刷新重试" : "正在加载定位记录…"}
        </p>
      </>
    );
  return (
    <>
      <div className="editor-toolbar">
        <div className="actions">
          <button
            onClick={() =>
              go(
                base +
                  "?" +
                  useQueryString(new URLSearchParams(q), {
                    measure: undefined,
                    event: undefined,
                    sourcePage: undefined,
                  }),
              )
            }
          >
            ‹ 定位样本列表
          </button>
          <b>{record.title}</b>
        </div>
        <span>小节与事件定位 · 几何任务</span>
        <div className="actions">
          <span
            className={"save-status " + (dirty ? "unsaved" : "saved")}
            role="status"
          >
            {dirty
              ? "未保存"
              : record.status === "confirmed"
                ? "几何已确认"
                : "待复核"}
          </span>
          <button
            disabled={!dirty || busy}
            onClick={() => void save().catch(() => {})}
          >
            保存
          </button>
          <button disabled={busy} onClick={() => void command("unconfirm")}>
            撤销确认
          </button>
          <button
            disabled={busy}
            className="primary"
            onClick={() => void command("confirm")}
          >
            确认几何与完整性
          </button>
        </div>
      </div>
      <div className="tools">
        {(["select", "measure", "event", "staff"] as const).map((v, i) => (
          <button
            key={v}
            className={mode === v ? "active" : ""}
            onClick={() => {
              setMode(v);
              setStaffClicks([]);
            }}
          >
            {["选择/拖动", "画小节框", "点击补事件", "逐根标记六弦线"][i]}
          </button>
        ))}
        <button disabled={!history.length} onClick={() => undo()}>
          撤销
        </button>
        <button disabled={!future.length} onClick={() => undo(true)}>
          重做
        </button>
        <button onClick={() => setZoom(Math.max(0.25, zoom / 1.25))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(Math.min(4, zoom * 1.25))}>＋</button>
        <button onClick={() => setShowSource(true)}>只读原始来源附件</button>
        <span className="muted small">
          {mode === "staff"
            ? `请从上到下点击六根弦线（${staffClicks.length}/6）`
            : "方向键微调1像素 · Shift方向键10像素 · 不编辑音高/时值"}
        </span>
      </div>
      <ErrorToast>{error}</ErrorToast>
      <div className="editor-body" inert={busy}>
        <aside className="sidebar">
          <h3>来源谱页</h3>
          {geometry.pages.map((p) => (
            <button
              key={p.localPageId}
              className={
                "page-button " + (pageId === p.localPageId ? "active" : "")
              }
              onClick={() => {
                setPageId(p.localPageId);
                const m = geometry.measures.find(
                  (m) => m.pageId === p.localPageId,
                );
                if (m) setMeasureId(m.id);
                location({
                  sourcePage: p.localPageId,
                  measure: m?.id,
                  event: undefined,
                });
              }}
            >
              {p.localPageId}
            </button>
          ))}
          <h3>小节 / 轨道</h3>
          {geometry.measures.map((m, i) => (
            <button
              key={m.id}
              className={"page-button " + (measureId === m.id ? "active" : "")}
              onClick={() => selectMeasure(m)}
            >
              {i + 1} · {m.track} · 声部{m.voice}
              <br />
              {m.geometryConfirmed ? "已确认" : "待复核"} ·{" "}
              {m.events.filter((e) => e.status !== "rejected").length}事件
            </button>
          ))}
          <div className="actions">
            <button
              disabled={!measure || geometry.measures.indexOf(measure) <= 0}
              onClick={() =>
                selectMeasure(
                  geometry.measures[geometry.measures.indexOf(measure!) - 1],
                )
              }
            >
              上一小节
            </button>
            <button
              disabled={
                !measure ||
                geometry.measures.indexOf(measure) >=
                  geometry.measures.length - 1
              }
              onClick={() =>
                selectMeasure(
                  geometry.measures[geometry.measures.indexOf(measure!) + 1],
                )
              }
            >
              下一小节
            </button>
          </div>
        </aside>
        <section
          className="loc-stage"
          tabIndex={0}
          aria-label="小节事件定位画布"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
              e.preventDefault();
              undo(e.shiftKey);
              return;
            }
            if (
              !measure ||
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            const dx =
                (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0) *
                (e.shiftKey ? 10 : 1),
              dy =
                (e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0) *
                (e.shiftKey ? 10 : 1);
            edit((g) => {
              const m = g.measures.find((m) => m.id === measure.id)!;
              if (event) {
                const ev = m.events.find((v) => v.id === event.id)!;
                if (ev.centerX !== null) ev.centerX += dx;
              } else if (m.bbox && page)
                translateMeasure(m, dx, dy, page.width, page.height);
            });
          }}
        >
          {page && image ? (
            <svg
              role="img"
              aria-label="原图及定位几何"
              viewBox={`0 0 ${page.width} ${page.height}`}
              style={{ width: zoom * 100 + "%", maxWidth: "none" }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={() => {
                if (gesture.current) {
                  setGeometry(gesture.current.before);
                  current.current = gesture.current.before;
                  gesture.current = null;
                }
              }}
            >
              <image href={image} width={page.width} height={page.height} />
              {geometry.measures
                .filter((m) => m.pageId === page.localPageId)
                .map((m) => (
                  <g key={m.id}>
                    {m.bbox && (
                      <>
                        <rect
                          className={
                            "measure " + (m.id === measureId ? "selected" : "")
                          }
                          data-kind="measure"
                          data-measure={m.id}
                          x={m.bbox[0]}
                          y={m.bbox[1]}
                          width={m.bbox[2] - m.bbox[0]}
                          height={m.bbox[3] - m.bbox[1]}
                        />
                        <text x={m.bbox[0]} y={m.bbox[1] - 5} fontSize={18}>
                          {m.barNumber || m.id.slice(0, 7)} · {m.track}/
                          {m.voice}
                        </text>
                        {m.id === measureId &&
                          [
                            [m.bbox[0], m.bbox[1]],
                            [m.bbox[2], m.bbox[1]],
                            [m.bbox[2], m.bbox[3]],
                            [m.bbox[0], m.bbox[3]],
                          ].map(([x, y], i) => (
                            <rect
                              key={i}
                              data-kind="corner"
                              data-measure={m.id}
                              data-corner={i}
                              x={x - 7}
                              y={y - 7}
                              width={14}
                              height={14}
                              fill="white"
                              stroke="#ea8154"
                            />
                          ))}
                      </>
                    )}
                    {m.staffLines?.map((y, i) => (
                      <line
                        key={i}
                        className="staff"
                        data-kind="staff"
                        data-measure={m.id}
                        data-line={i}
                        x1={m.bbox?.[0] || 0}
                        x2={m.bbox?.[2] || page.width}
                        y1={y}
                        y2={y}
                        strokeWidth={m.id === measureId ? 3 : 1}
                      />
                    ))}
                    {m.events.map(
                      (ev) =>
                        ev.centerX !== null && (
                          <g key={ev.id}>
                            <line
                              className={
                                "event " +
                                (ev.status === "rejected" ? "rejected" : "")
                              }
                              x1={ev.centerX}
                              x2={ev.centerX}
                              y1={m.bbox?.[1] || 0}
                              y2={m.bbox?.[3] || page.height}
                            />
                            <rect
                              data-kind="event"
                              data-measure={m.id}
                              data-event={ev.id}
                              x={ev.centerX - 9}
                              width={18}
                              y={m.bbox?.[1] || 0}
                              height={
                                (m.bbox?.[3] || page.height) -
                                (m.bbox?.[1] || 0)
                              }
                              fill={
                                ev.id === eventId ? "#22a89433" : "transparent"
                              }
                            />
                          </g>
                        ),
                    )}
                  </g>
                ))}
            </svg>
          ) : (
            <p>
              正在读取来源原图…
              {error && (
                <button onClick={() => setRetry((n) => n + 1)}>重试</button>
              )}
            </p>
          )}
        </section>
        <aside className="properties">
          <h3>当前小节几何</h3>
          {measure ? (
            <>
              <label>
                轨道
                <select
                  value={measure.track}
                  onChange={(e) =>
                    edit((g) => {
                      g.measures.find((m) => m.id === measure.id)!.track = e
                        .target.value as Measure["track"];
                    })
                  }
                >
                  <option>guitar</option>
                  <option>melody</option>
                </select>
              </label>
              <label>
                声部
                <input
                  value={measure.voice}
                  onChange={(e) =>
                    edit((g) => {
                      g.measures.find((m) => m.id === measure.id)!.voice =
                        e.target.value;
                    })
                  }
                />
              </label>
              <label>
                小节号
                <input
                  type="number"
                  min={1}
                  value={measure.barNumber ?? ""}
                  onChange={(e) =>
                    edit((g) => {
                      g.measures.find((m) => m.id === measure.id)!.barNumber = e
                        .target.value
                        ? Number(e.target.value)
                        : null;
                    })
                  }
                />
              </label>
              <label>
                原谱行ID（可空）
                <input
                  value={measure.systemId || ""}
                  onChange={(e) =>
                    edit((g) => {
                      g.measures.find((m) => m.id === measure.id)!.systemId =
                        e.target.value || null;
                    })
                  }
                />
              </label>
              <BBoxFields
                value={measure.bbox}
                label="小节框xyxy"
                change={(v) =>
                  edit((g) => {
                    g.measures.find((m) => m.id === measure.id)!.bbox = v;
                  })
                }
              />
              <label>
                六根弦线（有限小数，用逗号分隔）
                <input
                  key={measure.id + JSON.stringify(measure.staffLines)}
                  defaultValue={measure.staffLines?.join(",") || ""}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    edit((g) => {
                      g.measures.find((m) => m.id === measure.id)!.staffLines =
                        value ? value.split(",").map(Number) : null;
                    });
                  }}
                />
              </label>
              <button
                onClick={() => {
                  if (
                    window.confirm("删除此小节几何及其事件？保存前可撤销。")
                  ) {
                    edit((g) => {
                      g.measures = g.measures.filter(
                        (m) => m.id !== measure.id,
                      );
                    });
                    setMeasureId("");
                    setEventId("");
                  }
                }}
              >
                删除小节
              </button>
              <h3>完整谱行上下文</h3>
              {systemContext ? (
                <Preview src={image} box={systemContext} />
              ) : (
                <p className="small muted">
                  未提供可引用谱行框；保留整页上下文，不生成父框。
                </p>
              )}
              <h3>当前小节裁片</h3>
              <Preview src={image} box={measure.bbox} />
              <h3>事件（稳定ID）</h3>
              <button
                onClick={() =>
                  edit((g) => {
                    g.measures
                      .find((m) => m.id === measure.id)!
                      .events.sort(
                        (a, b) =>
                          (a.centerX ?? Infinity) - (b.centerX ?? Infinity) ||
                          a.id.localeCompare(b.id),
                      );
                  })
                }
              >
                按横坐标排序事件
              </button>
              <div className="box-list">
                {measure.events.map((e) => (
                  <button
                    key={e.id}
                    className={eventId === e.id ? "active" : ""}
                    onClick={() => selectEvent(measure, e)}
                  >
                    {e.id.slice(0, 12)} · {e.centerX ?? "未知"} · {e.status}
                  </button>
                ))}
              </div>
              {event && (
                <>
                  <label>
                    事件横坐标
                    <input
                      aria-label="事件横坐标"
                      type="number"
                      step="any"
                      value={event.centerX ?? ""}
                      onChange={(e) =>
                        edit((g) => {
                          g.measures
                            .find((m) => m.id === measure.id)!
                            .events.find((v) => v.id === event.id)!.centerX = e
                            .target.value
                            ? Number(e.target.value)
                            : null;
                        })
                      }
                    />
                  </label>
                  <label>
                    事件声部
                    <input
                      value={event.voice}
                      onChange={(e) =>
                        edit((g) => {
                          g.measures
                            .find((m) => m.id === measure.id)!
                            .events.find((v) => v.id === event.id)!.voice =
                            e.target.value;
                        })
                      }
                    />
                  </label>
                  <BBoxFields
                    value={event.bbox}
                    label="事件裁片xyxy"
                    change={(v) =>
                      edit((g) => {
                        g.measures
                          .find((m) => m.id === measure.id)!
                          .events.find((e) => e.id === event.id)!.bbox = v;
                      })
                    }
                  />
                  <BBoxFields
                    value={event.contextBBox}
                    label="上下文裁片xyxy"
                    change={(v) =>
                      edit((g) => {
                        g.measures
                          .find((m) => m.id === measure.id)!
                          .events.find((e) => e.id === event.id)!.contextBBox =
                          v;
                      })
                    }
                  />
                  <button
                    onClick={() => void reject(event.status === "rejected")}
                  >
                    {event.status === "rejected" ? "恢复事件" : "拒绝误检"}
                  </button>
                  <h3>当前事件裁片</h3>
                  <Preview src={image} box={event.bbox ?? event.contextBBox} />
                  <p className="small muted">
                    内容标签不在此编辑；未标裁片范围不会猜测。
                  </p>
                </>
              )}
            </>
          ) : (
            <p>请画小节框或选择已有小节。不根据答案或候选数量生成几何。</p>
          )}
        </aside>
      </div>
      <footer className="caption">
        {dirty ? "未保存修改只在当前页面" : "服务端版本 " + record.version} ·
        原图坐标，视图缩放不改标签 · SHA绑定来源
      </footer>
      {showSource && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>只读来源附件</h2>
            <p>保留原始内容、证据与AI状态，不能视为人工确认。</p>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: "60vh",
                overflow: "auto",
              }}
            >
              {JSON.stringify(record.original, null, 2)}
            </pre>
            <button onClick={() => setShowSource(false)}>关闭</button>
          </section>
        </div>
      )}
    </>
  );
}
function BBoxFields({
  value,
  label,
  change,
}: {
  value: XYXY | null;
  label: string;
  change: (v: XYXY | null) => void;
}) {
  return (
    <label>
      {label}
      <input
        aria-label={label}
        key={JSON.stringify(value)}
        defaultValue={value?.join(",") || ""}
        placeholder="未知可留空，例如60,300,550,480"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (!v) {
            if (value !== null) change(null);
            return;
          }
          const numbers = v.split(",").map(Number);
          if (numbers.length === 4 && !same(numbers, value))
            change(numbers as XYXY);
        }}
      />
    </label>
  );
}
