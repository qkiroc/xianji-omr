import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const moduleUrl = (source) =>
  "data:text/javascript;base64," +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  ).toString("base64");
const client = moduleUrl(
  await readFile(new URL("../shared/client.ts", import.meta.url), "utf8"),
);
const issuesUrl = moduleUrl(
  await readFile(
    new URL("../shared/region-issues.ts", import.meta.url),
    "utf8",
  ),
);
const source = (
  await readFile(
    new URL("../components/layout/canvas.ts", import.meta.url),
    "utf8",
  )
)
  .replace('"../../shared/client"', JSON.stringify(client))
  .replace('"../../shared/region-issues"', JSON.stringify(issuesUrl));
const { AnnotationCanvas } = await import(moduleUrl(source));
function setup() {
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.querySelector = () => null;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const stage = new EventTarget();
  Object.assign(stage, {
    clientWidth: 100,
    clientHeight: 100,
    style: {},
    focus() {},
    setPointerCapture() {},
    getBoundingClientRect() {
      return { left: 0, top: 0 };
    },
    querySelector() {
      return {
        getContext() {
          return {};
        },
      };
    },
  });
  const changes = [];
  const c = new AnnotationCanvas(stage, {
    onSelect() {},
    onChange(b) {
      changes.push(b);
    },
    getClass() {
      return "title";
    },
    color() {
      return "#000000";
    },
  });
  c.render = () => {};
  c.image = {};
  c.width = c.height = 100;
  c.scale = 1;
  c.ox = c.oy = 0;
  const key = (key, extra = {}) => {
    const e = new Event("keydown", { cancelable: true });
    Object.assign(e, { key, code: key, ...extra });
    window.dispatchEvent(e);
    return e;
  };
  const pointer = (x, y) => ({
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
  });
  return { c, stage, changes, key, pointer };
}
test("画完自动调整；连续绘制显式开启；切换工具先完成当前手势", () => {
  const { c, pointer } = setup();
  c.setMode("draw");
  c.down(pointer(10, 20));
  c.move(pointer(40, 60));
  c.finish();
  assert.equal(c.mode, "select");
  assert.deepEqual(
    [c.boxes[0].x, c.boxes[0].y, c.boxes[0].width, c.boxes[0].height],
    [10, 20, 30, 40],
  );
  assert.equal(c.selected, c.boxes[0].id);
  c.continuousDrawing = true;
  c.setMode("draw");
  assert.equal(c.selected, null);
  c.down(pointer(50, 50));
  c.move(pointer(70, 70));
  c.finish();
  assert.equal(c.mode, "draw");
  assert.equal(c.boxes.length, 2);
  c.down(pointer(75, 75));
  c.move(pointer(90, 90));
  c.setMode("select");
  assert.equal(c.gesture, null);
  assert.equal(c.boxes.length, 3);
  c.dispose();
});
test("取消或零尺寸绘制不会留下悬空选择；删除无效ID不误删其他框", () => {
  const { c, pointer } = setup();
  c.setMode("draw");
  c.down(pointer(10, 10));
  c.finish();
  assert.equal(c.boxes.length, 0);
  assert.equal(c.selected, null);
  c.setMode("draw");
  c.down(pointer(10, 10));
  c.move(pointer(40, 40));
  c.finish(true);
  assert.equal(c.boxes.length, 0);
  assert.equal(c.selected, null);
  c.boxes = [{ id: "keep", x: 1, y: 1, width: 10, height: 10 }];
  c.selected = "stale";
  c.remove();
  assert.equal(c.boxes[0].id, "keep");
  c.dispose();
});
test("方向键以原图像素移动、边界裁限、撤销重做，不随显示缩放改变", () => {
  const { c, key } = setup();
  c.boxes = [{ id: "a", x: 85, y: 10, width: 10, height: 10 }];
  c.select("a");
  c.scale = 0.25;
  key("ArrowRight", { shiftKey: true });
  assert.equal(c.boxes[0].x, 90);
  assert.equal(c.history.length, 1);
  key("z", { ctrlKey: true });
  assert.equal(c.boxes[0].x, 85);
  key("y", { ctrlKey: true });
  assert.equal(c.boxes[0].x, 90);
  c.dispose();
});
test("弹窗或隐藏画布不会被全局快捷键修改；组合键不触发画框", () => {
  const { c, key } = setup();
  c.boxes = [{ id: "a", x: 1, y: 1, width: 10, height: 10 }];
  c.select("a");
  document.querySelector = () => ({});
  key("Delete");
  assert.equal(c.boxes.length, 1);
  document.querySelector = () => null;
  c.stage.clientHeight = 0;
  key("Delete");
  assert.equal(c.boxes.length, 1);
  c.stage.clientHeight = 100;
  key("r", { ctrlKey: true });
  assert.equal(c.mode, "select");
  c.dispose();
});
test("普通滚轮平移；Ctrl滚轮以鼠标为锚缩放；选中隐藏与取消后显示全部", () => {
  const { c, stage } = setup();
  c.boxes = [{ id: "a" }, { id: "b" }];
  c.select("a");
  assert.deepEqual(
    c.visibleBoxes().map((b) => b.id),
    ["a"],
  );
  c.select(null);
  assert.equal(c.visibleBoxes().length, 2);
  const wheel = (ctrlKey) => {
    const e = new Event("wheel", { cancelable: true });
    Object.assign(e, {
      clientX: 50,
      clientY: 50,
      deltaX: 0,
      deltaY: 10,
      ctrlKey,
    });
    stage.dispatchEvent(e);
  };
  wheel(false);
  assert.equal(c.scale, 1);
  assert.equal(c.oy, -10);
  const before = (50 - c.ox) / c.scale;
  wheel(true);
  assert.notEqual(c.scale, 1);
  assert.ok(Math.abs((50 - c.ox) / c.scale - before) < 1e-10);
  c.dispose();
});
test("选中正常框仍高亮其他越出父谱行的框，修正后恢复隐藏", () => {
  const { c } = setup();
  const p = {
    id: "p",
    classKey: "system",
    parentSystemId: null,
    x: 0,
    y: 0,
    width: 50,
    height: 50,
  };
  const b = {
    id: "bad",
    classKey: "guitar",
    parentSystemId: "p",
    x: 40,
    y: 10,
    width: 20,
    height: 10,
  };
  c.boxes = [p, b, { id: "selected", x: 60, y: 60, width: 10, height: 10 }];
  c.select("selected");
  assert.deepEqual(
    c.visibleBoxes().map((b) => b.id),
    ["bad", "selected"],
  );
  b.width = 10;
  assert.deepEqual(
    c.visibleBoxes().map((b) => b.id),
    ["selected"],
  );
  c.dispose();
});
test("画布实际绘制红色问题框、感叹号及橙色虚线父谱行", () => {
  const { c } = setup();
  globalThis.devicePixelRatio = 1;
  const strokes = [],
    labels = [],
    dashes = [];
  c.ctx = {
    setTransform() {},
    clearRect() {},
    drawImage() {},
    fillRect() {},
    strokeRect() {
      strokes.push(this.strokeStyle);
    },
    fillText(t) {
      labels.push(t);
    },
    save() {},
    restore() {},
    setLineDash(v) {
      dashes.push(v);
    },
  };
  c.boxes = [
    {
      id: "p",
      classKey: "system",
      parentSystemId: null,
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    },
    {
      id: "bad",
      classKey: "guitar",
      parentSystemId: "p",
      x: 40,
      y: 10,
      width: 20,
      height: 10,
    },
  ];
  AnnotationCanvas.prototype.render.call(c);
  assert.ok(strokes.includes("#dc3545"));
  assert.ok(strokes.includes("#d58a16"));
  assert.ok(labels.some((v) => String(v).startsWith("! ")));
  assert.ok(labels.includes("所属谱行"));
  assert.deepEqual(dashes[0], [6, 4]);
  c.dispose();
});
