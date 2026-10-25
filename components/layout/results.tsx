"use client";
import { Select, Input, Button } from "../ui/antd";
import { useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import type { Box, Category, LayoutDocument } from "../../shared/client";
import { cropRectangle } from "../../server/src/crop-rules";
import { ErrorToast } from "../ui/toast";
export interface CropState {
  category: string;
  status: string;
  scroll: number;
  size: number;
}
const compactClasses = new Set([
  "title",
  "capo",
  "key_signature",
  "time_signature",
]);
function CropCanvas({ image, box }: { image?: HTMLImageElement; box: Box }) {
  const ref = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = c.height = 0;
    setError("");
    if (!image) return;
    try {
      cropRectangle(box, image.naturalWidth, image.naturalHeight);
      const scale = Math.min(1, 1600 / box.width, 600 / box.height);
      c.width = Math.max(1, Math.round(box.width * scale));
      c.height = Math.max(1, Math.round(box.height * scale));
      const ctx = c.getContext("2d");
      if (!ctx) throw Error("裁片画布初始化失败");
      ctx.drawImage(
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
    } catch (e) {
      c.width = c.height = 0;
      setError(e instanceof Error ? e.message : "裁片预览失败");
    }
  }, [image, box]);
  return (
    <>
      <canvas ref={ref} hidden={!!error} aria-label="当前框精确裁片" />
      {error && <ErrorToast>{error}</ErrorToast>}
      {error && (
        <span className="muted small">预览不可用，点击返回原图调整</span>
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
  selected,
  onSelect,
  stateRef,
}: {
  doc: LayoutDocument;
  image?: HTMLImageElement;
  taxonomy: Category[];
  dirty: boolean;
  onAdjust: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  stateRef: React.RefObject<CropState>;
}) {
  const query = useSearchParams();
  const [category, setCategory] = useState(
      query.get("cropClass") || stateRef.current.category,
    ),
    [size, setSize] = useState(
      Number(query.get("cropSize")) || stateRef.current.size,
    );
  const ref = useRef<HTMLElement>(null);
  const filtered = doc.boxes
    .filter((b) => !category || b.classKey === category)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = stateRef.current.scroll;
  }, []);
  useEffect(() => {
    stateRef.current = { ...stateRef.current, category, status: "", size };
    const q = new URLSearchParams(window.location.search);
    category ? q.set("cropClass", category) : q.delete("cropClass");
    q.delete("cropReview");
    q.set("cropSize", String(size));
    if (q.toString() !== new URLSearchParams(window.location.search).toString())
      window.history.replaceState(
        { omrIndex: window.history.state?.omrIndex, omrReplace: true },
        "",
        window.location.pathname + "?" + q,
      );
  }, [category, size]);
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
              : "按当前像素边界裁切"}{" "}
            · 悬停或聚焦裁片后按 Q 删除，Ctrl/⌘+Z 撤销 · 点击裁片返回原图调整
          </p>
        </div>
        <div className="actions">
          <Select
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
          </Select>
          <Input
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
        <p className="muted">正在加载来源图；如加载失败，请切回原图重试。</p>
      )}
      <div className="crop-cards">
        {filtered.map((b) => {
          const category = taxonomy.find((t) => t.key === b.classKey);
          return (
            <article
              key={b.id}
              data-box-id={b.id}
              className={
                "crop-card " +
                (compactClasses.has(b.classKey || "") ? "" : "wide") +
                (selected === b.id ? " crop-card-selected" : "")
              }
              style={{ outline: selected === b.id ? "2px solid" : undefined,
                outlineColor: category?.color, outlineOffset: 2 }}
              onPointerEnter={() => onSelect(b.id)}
              onPointerMove={() => onSelect(b.id)}
              onFocusCapture={() => onSelect(b.id)}
            >
              <div className="crop-card-head">
                <b style={{ color: category?.color }}>
                  {doc.boxes.indexOf(b) + 1} · {category?.name || "历史未归类"}
                </b>
                <span className="small muted">
                  {b.width}×{b.height}px
                </span>
              </div>
              <Button
                className="crop-preview"
                aria-label={"调整选区 " + b.id}
                title="点击返回原图调整"
                style={{ height: size }}
                onClick={() => onAdjust(b.id)}
              >
                <CropCanvas image={image} box={b} />
              </Button>
              {(b.metadata?.rawText ||
                Object.keys(b.metadata?.value || {}).length > 0) && (
                <p className="small muted">
                  {[
                    b.metadata?.rawText,
                    ...Object.values(b.metadata?.value || {}),
                  ]
                    .filter((v) => v !== undefined && v !== null && v !== "")
                    .join(" · ")}
                </p>
              )}
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <p>暂无符合条件的区域</p>
        </div>
      )}
    </section>
  );
}
