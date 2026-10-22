"use client";
import { useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import type { Box, Category, LayoutDocument } from "../../shared/client";
import { cropRectangle } from "../../server/src/crop-rules";
export interface CropState {
  category: string;
  status: string;
  scroll: number;
  size: number;
}
function CropCanvas({
  image,
  box,
  max = 1000,
}: {
  image?: HTMLImageElement;
  box: Box;
  max?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = c.height = 0;
    setError("");
    if (!image) return;
    try {
      cropRectangle(box, image.naturalWidth, image.naturalHeight);
    } catch (e) {
      setError(e instanceof Error ? e.message : "裁片边界无效");
      return;
    }
    const scale = Math.min(1, max / box.width, 400 / box.height);
    c.width = Math.max(1, Math.round(box.width * scale));
    c.height = Math.max(1, Math.round(box.height * scale));
    c.getContext("2d")?.drawImage(
      image,
      box.x,
      box.y,
      box.width,
      box.height,
      0,
      0,
      c.width,
      c.height,
    );
  }, [image, box, max]);
  return (
    <>
      <canvas ref={ref} hidden={!!error} aria-label="当前框精确裁片" />
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
export function LayoutCrops({
  doc,
  image,
  taxonomy,
  dirty,
  onAdjust,
  onReview,
  onRestore,
  stateRef,
}: {
  doc: LayoutDocument;
  image?: HTMLImageElement;
  taxonomy: Category[];
  dirty: boolean;
  onAdjust: (id: string) => void;
  onReview: (id: string, status: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  stateRef: React.RefObject<CropState>;
}) {
  const query = useSearchParams();
  const [category, setCategory] = useState(
      query.get("cropClass") || stateRef.current.category,
    ),
    [status, setStatus] = useState(
      query.get("cropReview") || stateRef.current.status,
    ),
    [size, setSize] = useState(
      Number(query.get("cropSize")) || stateRef.current.size,
    ),
    [large, setLarge] = useState<Box | null>(null),
    ref = useRef<HTMLElement>(null),
    overview = useRef<HTMLCanvasElement>(null);
  const review = (b: Box) =>
    b.reviewStatus ||
    (doc.image.status === "confirmed" ? "confirmed" : "draft");
  const filtered = doc.boxes
    .filter(
      (b) =>
        (!category || b.classKey === category) &&
        (!status || review(b) === status),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const names: Record<string, string> = {
    draft: "未复核",
    confirmed: "确认无误",
    needs_adjustment: "需调整",
  };
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = stateRef.current.scroll;
    return () => {};
  }, []);
  useEffect(() => {
    stateRef.current = { ...stateRef.current, category, status, size };
    const q = new URLSearchParams(window.location.search);
    category ? q.set("cropClass", category) : q.delete("cropClass");
    status ? q.set("cropReview", status) : q.delete("cropReview");
    q.set("cropSize", String(size));
    if (q.toString() !== new URLSearchParams(window.location.search).toString())
      window.history.replaceState(
        { omrIndex: window.history.state?.omrIndex, omrReplace: true },
        "",
        window.location.pathname + "?" + q,
      );
  }, [category, status, size]);
  useEffect(() => {
    if (!overview.current) return;
    overview.current.width = overview.current.height = 0;
    if (!image) return;
    const c = overview.current,
      scale = Math.min(180 / doc.image.width, 280 / doc.image.height);
    c.width = doc.image.width * scale;
    c.height = doc.image.height * scale;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0, c.width, c.height);
    for (const b of doc.boxes) {
      ctx.strokeStyle =
        taxonomy.find((t) => t.key === b.classKey)?.color || "#999";
      ctx.strokeRect(
        b.x * scale,
        b.y * scale,
        b.width * scale,
        b.height * scale,
      );
    }
  }, [doc.boxes, image, taxonomy]);
  return (
    <section
      className="crop-results"
      ref={ref}
      onScroll={(e) => {
        stateRef.current.scroll = e.currentTarget.scrollTop;
      }}
    >
      <div className="section-head">
        <div>
          <h2>
            裁片结果 {filtered.length}/{doc.boxes.length}
          </h2>
          <p className="muted">
            {dirty
              ? "预览当前未保存修改 · 保存后才更新服务端"
              : "按当前整数像素边界裁切，不自动扩框"}
          </p>
        </div>
        <div className="actions">
          <select
            aria-label="裁片类别"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">全部类别</option>
            {taxonomy.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="裁片复核状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            {Object.entries(names).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <input
            aria-label="预览大小"
            type="range"
            min={120}
            max={360}
            step={20}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </div>
      </div>
      {!image && (
        <p className="error">来源图未加载，不能显示旧裁片。请切回原图重试。</p>
      )}
      <div className="crop-layout">
        <aside className="overview">
          <h3>原图总览</h3>
          <canvas ref={overview} aria-label="原图及全部标注框总览" />
          <p className="muted small">
            总览始终显示全部框。已有裁片不能证明没有漏标，整页仍需人工检查。
          </p>
        </aside>
        <div className="crop-cards">
          {filtered.map((b, i) => (
            <article
              key={b.id}
              className={
                "crop-card " +
                ([
                  "system",
                  "guitar",
                  "melody",
                  "lyrics",
                  "staff_notation",
                  "other_tab",
                ].includes(b.classKey || "")
                  ? "wide"
                  : "")
              }
            >
              <div className="crop-card-head">
                <b>
                  {doc.boxes.indexOf(b) + 1} ·{" "}
                  {taxonomy.find((t) => t.key === b.classKey)?.name ||
                    "历史未归类"}
                </b>
                <span className={"review-chip " + review(b)}>
                  {names[review(b)]}
                </span>
              </div>
              <button
                className="crop-preview"
                aria-label={"调整选区 " + b.id}
                style={{ height: size }}
                onClick={() => onAdjust(b.id)}
              >
                <CropCanvas image={image} box={b} />
              </button>
              <p className="small muted">
                {b.width}×{b.height}px ·{" "}
                {[
                  b.metadata?.rawText,
                  ...Object.values(b.metadata?.value || {}),
                ]
                  .filter((v) => v !== undefined)
                  .join(" · ")}
              </p>
              <div className="icon-actions">
                {[
                  ["✎", "调整选区", () => onAdjust(b.id)],
                  ["⌕", "查看大图", () => setLarge(b)],
                  ["⚑", "标记需调整", () => onReview(b.id, "needs_adjustment")],
                  ["✓", "确认无误", () => onReview(b.id, "confirmed")],
                ].map(([icon, label, fn]) => (
                  <button
                    key={String(label)}
                    title={String(label)}
                    aria-label={String(label)}
                    onClick={() => void (fn as () => void)()}
                  >
                    {String(icon)}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
      <details className="panel">
        <summary>已删除区域（可恢复）</summary>
        {doc.deletedBoxes.map((b) => (
          <button key={b.id} onClick={() => void onRestore(b.id)}>
            恢复 · {b.id}
          </button>
        ))}
      </details>
      {large && (
        <div className="modal-backdrop">
          <section className="modal" style={{ width: "min(1100px,94vw)" }}>
            <h2>
              {large.width}×{large.height}px
            </h2>
            <CropCanvas image={image} box={large} max={4096} />
            <button onClick={() => setLarge(null)}>关闭大图</button>
          </section>
        </div>
      )}
    </section>
  );
}
