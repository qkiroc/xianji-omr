import { regionIssues } from "../../shared/region-issues";
import { clientId } from "../../shared/client";
import { blocksEditorShortcut } from "../../shared/editor-shortcuts";
const META = [
  "title",
  "performer",
  "time_signature",
  "key_signature",
  "tempo",
  "capo",
];
const clone = <T>(v: T): T => structuredClone(v);
const uid = () => clientId();
const clamp = (n: any, min: any, max: any) => Math.max(min, Math.min(max, n));
export class AnnotationCanvas {
  [key: string]: any;
  constructor(
    stage: any,
    { onSelect, onChange, getClass, color, onRemoveRequest }: any,
  ) {
    this.stage = stage;
    this.canvas = stage.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    Object.assign(this, {
      onSelect,
      onChange,
      getClass,
      color,
      onRemoveRequest,
    });
    this.scale = 1;
    this.ox = this.oy = 0;
    this.mode = "select";
    this.boxes = [];
    this.history = [];
    this.future = [];
    this.abort = new AbortController();
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(stage);
    stage.addEventListener("pointerdown", (e: any) => this.down(e), {
      signal: this.abort.signal,
    });
    stage.addEventListener("pointermove", (e: any) => this.move(e), {
      signal: this.abort.signal,
    });
    stage.addEventListener("pointerup", () => this.finish(), {
      signal: this.abort.signal,
    });
    stage.addEventListener("pointercancel", () => this.finish(true), {
      signal: this.abort.signal,
    });
    stage.addEventListener("lostpointercapture", () => this.finish(), {
      signal: this.abort.signal,
    });
    stage.addEventListener(
      "wheel",
      (e: any) => {
        e.preventDefault();
        const p = this.point(e);
        if (e.ctrlKey || e.metaKey) {
          this.zoom(this.scale * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
        } else {
          this.ox -= e.deltaX;
          this.oy -= e.deltaY;
          this.render();
        }
      },
      { passive: false, signal: this.abort.signal },
    );
    window.addEventListener(
      "keydown",
      (e: any) => {
        if (
          e.defaultPrevented || e.isComposing || e.keyCode === 229 ||
          blocksEditorShortcut(e) ||
          this.stage.closest?.("[inert]") ||
          !this.stage.clientHeight ||
          !this.image ||
          (e.target.tagName === "BUTTON" && ["Space", "Enter"].includes(e.code))
        )
          return;
        if (e.code === "Space") {
          e.preventDefault();
          this.space = true;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey ? this.redo() : this.undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
          e.preventDefault();
          this.redo();
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
          this.selected
        ) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          this.edit((boxes: any[]) => {
            const b = boxes.find((b) => b.id === this.selected);
            if (!b) return;
            b.x = clamp(
              b.x +
                (e.key === "ArrowRight"
                  ? step
                  : e.key === "ArrowLeft"
                    ? -step
                    : 0),
              0,
              this.width - b.width,
            );
            b.y = clamp(
              b.y +
                (e.key === "ArrowDown"
                  ? step
                  : e.key === "ArrowUp"
                    ? -step
                    : 0),
              0,
              this.height - b.height,
            );
          });
        }
        if (!e.repeat && ["Delete", "Backspace"].includes(e.key)) {
          e.preventDefault();
          this.remove();
        }
        if (e.key === "Escape") {
          this.finish(true);
          this.setMode("select");
          this.select(null);
        }
        if (
          ({ v: "select", r: "draw", h: "pan" } as Record<string, string>)[
            e.key.toLowerCase()
          ]
        )
          this.setMode(
            ({ v: "select", r: "draw", h: "pan" } as Record<string, string>)[
              e.key.toLowerCase()
            ],
          );
        if (/^[0-6]$/.test(e.key))
          document.dispatchEvent(
            new CustomEvent("class-shortcut", { detail: Number(e.key) }),
          );
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      "keyup",
      (e: any) => {
        if (e.code === "Space") this.space = false;
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      "blur",
      () => {
        this.space = false;
        this.finish();
      },
      { signal: this.abort.signal },
    );
  }
  dispose() {
    this.abort.abort();
    this.observer.disconnect();
  }
  async load(
    src: any,
    boxes: any,
    w: any,
    h: any,
    isCurrent: () => boolean = () => true,
  ) {
    const image = new Image();
    image.src = src;
    await image.decode();
    if (!isCurrent()) return;
    if (image.naturalWidth !== w || image.naturalHeight !== h)
      throw Error("坐标工作图尺寸不一致");
    this.image = image;
    this.width = w;
    this.height = h;
    this.boxes = clone(boxes);
    this.selected = null;
    this.history = [];
    this.future = [];
    this.fit();
  }
  point(e: any) {
    const r = this.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  pixel(p: any) {
    return {
      x: clamp(Math.round((p.x - this.ox) / this.scale), 0, this.width),
      y: clamp(Math.round((p.y - this.oy) / this.scale), 0, this.height),
    };
  }
  corners(b: any) {
    return [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x + b.width, b.y + b.height],
      [b.x, b.y + b.height],
    ].map(([x, y]: any) => [
      this.ox + x * this.scale,
      this.oy + y * this.scale,
    ]);
  }
  focusRegion(id: any) {
    const b = this.boxes.find((b: any) => b.id === id);
    if (!b) return;
    const r = this.stage.getBoundingClientRect();
    this.scale = clamp(
      Math.min(
        (r.width - 100) / (b.width * 1.5),
        (r.height - 100) / (b.height * 1.8),
      ),
      0.01,
      4,
    );
    this.ox = r.width / 2 - (b.x + b.width / 2) * this.scale;
    this.oy = r.height / 2 - (b.y + b.height / 2) * this.scale;
    this.select(id);
    this.setMode("select");
  }
  setMode(mode: any) {
    this.finish();
    if (mode === "draw" && this.mode !== "draw") this.select(null);
    this.mode = mode;
    this.stage.style.cursor =
      mode === "draw" ? "crosshair" : mode === "pan" ? "grab" : "default";
    document.dispatchEvent(new CustomEvent("canvas-mode", { detail: mode }));
  }
  fit() {
    if (!this.image) return;
    this.scale = Math.max(
      0.01,
      Math.min(
        (this.stage.clientWidth - 72) / this.width,
        (this.stage.clientHeight - 72) / this.height,
      ),
    );
    this.ox = (this.stage.clientWidth - this.width * this.scale) / 2;
    this.oy = (this.stage.clientHeight - this.height * this.scale) / 2;
    this.render();
  }
  zoom(
    s: any,
    x: any = this.stage.clientWidth / 2,
    y: any = this.stage.clientHeight / 2,
  ) {
    s = clamp(s, 0.01, 16);
    this.ox = x - ((x - this.ox) * s) / this.scale;
    this.oy = y - ((y - this.oy) * s) / this.scale;
    this.scale = s;
    this.render();
  }
  visibleBoxes() {
    const invalid = new Set(regionIssues(this.boxes).map((i) => i.boxId));
    return this.boxes.some((b: any) => b.id === this.selected)
      ? this.boxes.filter(
          (b: any) => b.id === this.selected || invalid.has(b.id),
        )
      : this.boxes;
  }
  render() {
    const { canvas, ctx, stage } = this,
      w = stage.clientWidth,
      h = stage.clientHeight,
      dpr = devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.image) {
      ctx.drawImage(
        this.image,
        this.ox,
        this.oy,
        this.width * this.scale,
        this.height * this.scale,
      );
      const issues = new Map(regionIssues(this.boxes).map((i) => [i.boxId, i]));
      for (const parentId of new Set(
        [...issues.values()].map((i) => i.parentId),
      )) {
        const parent = this.boxes.find(
          (b: any) => b.id === parentId && b.classKey === "system",
        );
        if (!parent) continue;
        const [x, y] = this.corners(parent)[0];
        ctx.save();
        ctx.strokeStyle = "#d58a16";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(
          x,
          y,
          parent.width * this.scale,
          parent.height * this.scale,
        );
        ctx.fillStyle = "#a66a0b";
        ctx.font = "11px system-ui";
        ctx.fillText("所属谱行", x + 4, y - 6);
        ctx.restore();
      }
      this.visibleBoxes().forEach((b: any) => {
        const i = this.boxes.indexOf(b);
        const [x, y] = this.corners(b)[0],
          w = b.width * this.scale,
          h = b.height * this.scale;
        const invalid = issues.has(b.id);
        ctx.strokeStyle = invalid ? "#dc3545" : this.color(b.classKey);
        ctx.lineWidth = invalid ? 3 : b.id === this.selected ? 2.5 : 1.5;
        ctx.fillStyle =
          ctx.strokeStyle + (b.id === this.selected ? "26" : "0b");
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(x, y, 28, 19);
        ctx.fillStyle = "white";
        ctx.font = "11px system-ui";
        ctx.fillText((invalid ? "! " : "") + (i + 1), x + 4, y + 13);
        if (b.id === this.selected)
          for (const [cx, cy] of this.corners(b)) {
            ctx.fillStyle = "white";
            ctx.strokeStyle = this.color(b.classKey);
            ctx.fillRect(cx - 5, cy - 5, 10, 10);
            ctx.strokeRect(cx - 5, cy - 5, 10, 10);
          }
      });
    }
    document.dispatchEvent(
      new CustomEvent("canvas-view", {
        detail: {
          scale: this.scale,
          undo: this.history.length,
          redo: this.future.length,
        },
      }),
    );
  }
  select(id: any) {
    this.selected = id;
    this.render();
    this.onSelect(id);
  }
  down(e: any) {
    if (!this.image || e.button === 2 || this.stage.closest?.("[inert]"))
      return;
    this.stage.focus();
    const p = this.point(e),
      q = this.pixel(p);
    this.stage.setPointerCapture(e.pointerId);
    if (this.space || this.mode === "pan" || e.button === 1) {
      this.gesture = { type: "pan", p, ox: this.ox, oy: this.oy };
      return;
    }
    const b = this.boxes.find((b: any) => b.id === this.selected);
    if (this.mode === "select" && b) {
      const c = this.corners(b).findIndex(
        ([x, y]: any) => Math.hypot(x - p.x, y - p.y) <= 9,
      );
      if (c >= 0) {
        this.gesture = {
          type: "resize",
          c,
          b: clone(b),
          before: clone(this.boxes),
        };
        return;
      }
    }
    if (this.mode === "draw") {
      if (
        p.x < this.ox ||
        p.y < this.oy ||
        p.x > this.ox + this.width * this.scale ||
        p.y > this.oy + this.height * this.scale
      )
        return;
      const cls = this.getClass(),
        parent =
          cls === "system" || META.includes(cls)
            ? null
            : this.boxes
                .filter(
                  (b: any) =>
                    b.classKey === "system" &&
                    q.x >= b.x &&
                    q.y >= b.y &&
                    q.x <= b.x + b.width &&
                    q.y <= b.y + b.height,
                )
                .at(-1)?.id || null;
      const box = {
        ...(META.includes(cls) ? { metadata: { scope: "page" } } : {}),
        id: uid(),
        classKey: cls,
        parentSystemId: parent,
        readingOrder: this.boxes.length,
        x: q.x,
        y: q.y,
        width: 0,
        height: 0,
      };
      this.gesture = { type: "draw", q, before: clone(this.boxes) };
      this.boxes.push(box);
      this.selected = box.id;
      this.render();
      return;
    }
    const outside =
      p.x < this.ox ||
      p.y < this.oy ||
      p.x > this.ox + this.width * this.scale ||
      p.y > this.oy + this.height * this.scale;
    const hits = outside
      ? []
      : this.visibleBoxes()
          .filter(
            (b: any) =>
              q.x >= b.x &&
              q.y >= b.y &&
              q.x < b.x + b.width &&
              q.y < b.y + b.height,
          )
          .sort((a: any, b: any) => a.width * a.height - b.width * b.height);
    const hit = hits[0];
    this.select(hit?.id || null);
    if (hit)
      this.gesture = {
        type: "move",
        q,
        b: clone(hit),
        before: clone(this.boxes),
      };
  }
  move(e: any) {
    const g = this.gesture;
    if (!g) return;
    const p = this.point(e);
    if (g.type === "pan") {
      this.ox = g.ox + p.x - g.p.x;
      this.oy = g.oy + p.y - g.p.y;
      this.render();
      return;
    }
    const q = this.pixel(p),
      b = this.boxes.find((b: any) => b.id === this.selected);
    if (g.type === "draw") {
      Object.assign(b, {
        x: Math.min(q.x, g.q.x),
        y: Math.min(q.y, g.q.y),
        width: Math.abs(q.x - g.q.x),
        height: Math.abs(q.y - g.q.y),
      });
    }
    if (g.type === "move") {
      b.x = clamp(g.b.x + q.x - g.q.x, 0, this.width - b.width);
      b.y = clamp(g.b.y + q.y - g.q.y, 0, this.height - b.height);
    }
    if (g.type === "resize") {
      const ax = [0, 3].includes(g.c) ? g.b.x + g.b.width : g.b.x,
        ay = [0, 1].includes(g.c) ? g.b.y + g.b.height : g.b.y;
      b.width = Math.max(1, Math.abs(q.x - ax));
      b.height = Math.max(1, Math.abs(q.y - ay));
      b.x = clamp(Math.min(ax, q.x), 0, this.width - b.width);
      b.y = clamp(Math.min(ay, q.y), 0, this.height - b.height);
    }
    this.render();
  }
  finish(cancel: any = false) {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.type === "pan") return;
    if (cancel) this.boxes = g.before;
    else {
      this.boxes = this.boxes.filter((b: any) => b.width && b.height);
      if (JSON.stringify(g.before) !== JSON.stringify(this.boxes)) {
        this.history.push(g.before);
        if (this.history.length > 100) this.history.shift();
        this.future = [];
        this.onChange(clone(this.boxes));
      }
    }
    if (!this.boxes.some((b: any) => b.id === this.selected))
      this.selected = null;
    if (g.type === "draw" && !cancel && !this.continuousDrawing)
      this.setMode("select");
    this.render();
    this.onSelect(this.selected);
  }
  edit(fn: any) {
    this.finish();
    const before = clone(this.boxes);
    fn(this.boxes);
    if (JSON.stringify(before) === JSON.stringify(this.boxes)) return;
    this.history.push(before);
    if (this.history.length > 100) this.history.shift();
    this.future = [];
    this.onChange(clone(this.boxes));
    this.render();
    this.onSelect(this.selected);
  }
  remove() {
    if (this.onRemoveRequest) {
      this.finish(true);
      this.onRemoveRequest();
      return;
    }
    this.removeLocal();
  }
  removeLocal() {
    this.finish(true);
    if (!this.selected || !this.boxes.some((b: any) => b.id === this.selected))
      return;
    const id = this.selected;
    this.edit((boxes: any) => {
      const b = boxes.find((b: any) => b.id === id);
      boxes.splice(
        boxes.findIndex((b: any) => b.id === id),
        1,
      );
      if (b.classKey === "system")
        for (const child of boxes)
          if (child.parentSystemId === id) child.parentSystemId = null;
    });
    this.select(null);
  }
  undo() {
    this.finish();
    if (!this.history.length) return;
    this.future.push(clone(this.boxes));
    this.boxes = this.history.pop();
    this.select(null);
    this.onChange(clone(this.boxes));
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(clone(this.boxes));
    this.boxes = this.future.pop();
    this.select(null);
    this.onChange(clone(this.boxes));
  }
}
