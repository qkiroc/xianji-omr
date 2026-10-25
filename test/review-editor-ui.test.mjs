import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { compile } from "./compile-ui.mjs";
const window = new Window({ url: "http://localhost/" });
after(() => window.happyDOM.abort());
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node",
  "ShadowRoot", "HTMLInputElement", "HTMLFormElement", "HTMLButtonElement",
  "MutationObserver", "ResizeObserver", "FormData", "File", "Event", "CustomEvent",
  "MouseEvent", "SubmitEvent", "SVGElement", "history", "location"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? window : window[name] });
}
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.devicePixelRatio = 1;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
const ctx = {
  setTransform() {}, clearRect() {}, drawImage() {}, fillRect() {}, strokeRect() {},
  fillText() {}, save() {}, restore() {}, setLineDash() {},
};
window.HTMLCanvasElement.prototype.getContext = () => ctx;
globalThis.Image = class {
  naturalWidth = 200;
  naturalHeight = 160;
  async decode() {}
};
URL.createObjectURL = () => "blob:test";
URL.revokeObjectURL = () => {};
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;
const require = createRequire(import.meta.url);
const { SearchParamsContext, PathnameContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { LayoutEditor } = await import(await compile(fileURLToPath(
  new URL("../components/layout/editor.tsx", import.meta.url),
)));
const { NavigationProvider } = await import(await compile(fileURLToPath(
  new URL("../components/navigation.tsx", import.meta.url),
)));
const { UiProvider } = await import(await compile(fileURLToPath(
  new URL("../components/ui/provider.tsx", import.meta.url),
)));
const box = {
  id: "region", classKey: "title", parentSystemId: null, readingOrder: 0,
  x: 10, y: 10, width: 80, height: 20, metadata: { scope: "page" },
};
const page = (id, order) => ({
  image: { id, songId: "song", datasetId: "ds", name: "score-" + id + ".png",
    status: "ai_reviewed", annotationFormat: "layout-v2", pageType: "music",
    pageOrder: order, version: 1, coordinate: {}, width: 200, height: 160 },
  boxes: [structuredClone(box), { ...structuredClone(box), id: "keep", readingOrder: 1, x: 100 }], deletedBoxes: [],
});
async function mount(t, { second = true, failSave = false, view = "original" } = {}) {
  const pages = new Map([["a", page("a", 2)], ...(second ? [["b", page("b", 5)]] : [])]);
  const requests = [], routes = [];
  window.sessionStorage.clear();
  const initial = "/datasets/ds/songs/song/pages/a?status=ai_reviewed&queue=ai_reviewed&split=train&search=score&page=2&view=" + view;
  history.replaceState({}, "", initial);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path: url.pathname, query: url.searchParams, method, body });
    let value;
    if (url.pathname === "/api/v2/taxonomy")
      value = { categories: [{ key: "title", name: "标题", id: 7, color: "#9857cf" }] };
    else if (url.pathname === "/api/v2/datasets/ds/songs")
      value = [{ id: "song", name: "测试歌曲", page_count: 5 }];
    else if (url.pathname.endsWith("/content")) return new Response("image");
    else if (url.pathname.endsWith("/neighbors")) {
      const id = url.pathname.split("/").at(-2);
      const candidates = [...pages.values()].filter(p => p.image.id !== id &&
        p.image.status === url.searchParams.get("status"));
      value = { previousPage: null,
        nextPage: candidates[0] ? { id: candidates[0].image.id, songId: "song" } : null };
    } else {
      const match = url.pathname.match(/\/pages\/([^/]+)(?:\/(confirm|unconfirm))?$/);
      assert.ok(match, "Unexpected request " + url.pathname);
      const current = pages.get(match[1]);
      assert.ok(current);
      if (method === "PUT") {
        if (failSave) return Response.json({ error: "模拟保存失败" }, { status: 503 });
        assert.equal(body.version, current.image.version);
        current.boxes = structuredClone(body.boxes);
        current.image.pageType = body.pageType;
        current.image.version++;
        current.image.status = "draft";
      } else if (method === "POST") {
        assert.equal(body.version, current.image.version);
        current.image.status = match[2] === "unconfirm" ? "draft" :
          body.reviewType === "ai" ? "ai_reviewed" : "confirmed";
        current.image.version++;
      }
      value = structuredClone(current);
    }
    return Response.json(value);
  };
  function Harness() {
    const [route, setRoute] = React.useState(initial);
    const url = new URL(route, "http://localhost");
    const id = url.pathname.split("/").at(-1);
    const navigate = (next, replace = false) => {
      routes.push(next);
      replace ? history.replaceState(history.state, "", next) : history.pushState({}, "", next);
      setRoute(next);
    };
    const router = React.useMemo(() => ({
      push: next => navigate(next), replace: next => navigate(next, true),
    }), []);
    return h(AppRouterContext.Provider, { value: router },
      h(PathnameContext.Provider, { value: url.pathname },
        h(SearchParamsContext.Provider, { value: new URLSearchParams(url.search) },
          h(UiProvider, null, h(NavigationProvider, null,
            h(LayoutEditor, { datasetId: "ds", songId: "song", pageId: id }),
          )),
        ),
      ),
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
  await act(async () => { root.render(h(Harness)); });
  const find = (text) => [...host.querySelectorAll("button")]
    .find(b => b.textContent.replace(/\s/g, "").includes(text.replace(/\s/g, "")));
  const click = async (text) => {
    const button = find(text);
    assert.ok(button, "Missing button " + text);
    assert.equal(button.disabled, false, "Disabled button " + text);
    await act(async () => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  };
  // Effects fetch data, decode the image and initialise the canvas.
  await act(async () => {});
  return { host, pages, requests, routes, find, click };
}
test("真实编辑器删框无需确认，仅保存时PUT；撤销/重做及干净状态", async t => {
  const m = await mount(t);
  await m.click("标题");
  // Category selection chooses draw mode; select the saved region through its list.
  await m.click("1 ·");
  await m.click("删除框");
  assert.equal(document.querySelector(".ant-modal"), null);
  assert.ok(m.host.textContent.includes("未保存"));
  assert.equal(m.pages.get("a").boxes.length, 2);
  assert.equal(m.requests.filter(r => r.method !== "GET").length, 0);
  await m.click("撤销");
  assert.ok(!m.host.querySelector(".save-status.unsaved"));
  await m.click("重做");
  await m.click("保存");
  assert.deepEqual(m.pages.get("a").boxes.map(b => b.id), ["keep"]);
  assert.equal(m.requests.filter(r => r.method === "PUT").length, 1);
  assert.ok(!m.requests.some(r => r.path.includes("deletions")));
  assert.equal(m.find("撤销").disabled, true);
});
test("确认直接保存后进入同类下一页；上一页可返回刚确认的页面", async t => {
  const m = await mount(t);
  await m.click("1 ·");
  await m.click("删除框");
  await m.click("确认并下一页");
  assert.equal(m.pages.get("a").image.status, "confirmed");
  assert.ok(m.routes.at(-1).includes("/pages/b?"));
  assert.ok(m.routes.at(-1).includes("queue=ai_reviewed"));
  assert.equal(document.querySelector(".ant-modal"), null);
  for (const r of m.requests.filter(r => r.path.endsWith("/neighbors"))) {
    assert.equal(r.query.get("status"), "ai_reviewed");
    assert.equal(r.query.get("search"), "score");
    assert.equal(r.query.get("split"), "train");
  }
  await act(async () => {});
  await m.click("上一页");
  assert.ok(m.routes.at(-1).includes("/pages/a?"));
  assert.equal(m.pages.get("a").image.status, "confirmed");
});
test("保存失败保留修改和撤销历史，确认请求与跳页均不会发生", async t => {
  const m = await mount(t, { failSave: true });
  await m.click("1 ·");
  await m.click("删除框");
  await m.click("确认并下一页");
  assert.equal(m.routes.length, 0);
  assert.equal(m.requests.filter(r => r.method === "POST").length, 0);
  assert.equal(m.pages.get("a").boxes.length, 2);
  assert.ok(m.host.querySelector(".save-status.unsaved"));
  await m.click("撤销");
  assert.ok(!m.host.querySelector(".save-status.unsaved"));
});
test("最后一页确认成功后留在本页，无报错弹窗或跳回自身", async t => {
  const m = await mount(t, { second: false });
  await m.click("确认并下一页");
  assert.equal(m.pages.get("a").image.status, "confirmed");
  assert.equal(m.routes.length, 0);
  assert.equal(document.querySelector(".ant-modal"), null);
  assert.equal(m.find("下一页 ›").disabled, true);
});

test("未保存时翻页可取消，保存后继续才记录上一页", async t => {
  const m = await mount(t);
  await m.click("1 ·");
  await m.click("删除框");
  await m.click("下一页 ›");
  assert.equal(m.routes.length, 0);
  const dialogButton = text => [...document.querySelectorAll(".ant-modal button")]
    .find(b => b.textContent.replace(/\s/g, "") === text);
  await act(async () => dialogButton("留在本页")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  assert.equal(m.routes.length, 0);
  assert.ok(m.host.querySelector(".save-status.unsaved"));
  await m.click("下一页 ›");
  await act(async () => dialogButton("保存后继续")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  assert.ok(m.routes.at(-1).includes("/pages/b?"));
  assert.equal(m.pages.get("a").boxes.length, 1);
  await act(async () => {});
  await m.click("上一页");
  assert.ok(m.routes.at(-1).includes("/pages/a?"));
});

async function keypress(target, key, options = {}) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => target.dispatchEvent(event));
  return event;
}
async function selectShortcutTarget(m, view) {
  if (view === "original") await m.click("1 ·");
  else {
    await act(async () => m.host.querySelector(".crop-card")
      .dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true })));
    assert.ok(m.host.querySelector(".crop-card-selected"));
  }
}
for (const modifier of ["ctrlKey", "metaKey"]) {
  for (const view of ["original", "crops"]) {
    test(`Q delete, undo/redo and ${modifier} save work in ${view}`, async t => {
      const m = await mount(t, { view });
      await selectShortcutTarget(m, view);
      const target = m.host.querySelector(view === "original" ? ".stage" : ".crop-results");
      await keypress(target, "q");
      assert.ok(m.host.querySelector(".save-status.unsaved"));
      assert.equal(m.requests.filter(r => r.method !== "GET").length, 0);
      assert.equal(document.querySelector(".ant-modal"), null);
      await keypress(target, "z", { [modifier]: true });
      assert.equal(m.host.querySelector(".save-status.unsaved"), null, "One undo restores the deleted mark");
      await keypress(target, "Z", { [modifier]: true, shiftKey: true });
      assert.ok(m.host.querySelector(".save-status.unsaved"));
      await keypress(target, "z", { [modifier]: true });
      await keypress(target, "y", { [modifier]: true });
      assert.ok(m.host.querySelector(".save-status.unsaved"));
      const saved = await keypress(target, "s", { [modifier]: true });
      assert.equal(saved.defaultPrevented, true, "Suppress browser Save Page");
      assert.equal(m.pages.get("a").boxes.length, 1);
      assert.equal(m.requests.filter(r => r.method === "PUT").length, 1);
      assert.equal(m.host.querySelector(".save-status.unsaved"), null);
      await keypress(target, "s", { [modifier]: true });
      assert.equal(m.requests.filter(r => r.method === "PUT").length, 1, "Clean saves do not repeat requests");
      await keypress(target, "z", { [modifier]: true });
      assert.equal(m.host.querySelector(".save-status.unsaved"), null, "Saved history has been reset");
    });
  }
}

test("Text input keeps Q and native undo, while Ctrl+S saves pending marks", async t => {
  const m = await mount(t);
  await m.click("1 ·");
  const input = m.host.querySelector(".properties textarea");
  assert.ok(input);
  await keypress(input, "q");
  await keypress(input, "Backspace");
  await keypress(input, "z", { ctrlKey: true });
  assert.equal(m.host.querySelector(".save-status.unsaved"), null);
  const stage = m.host.querySelector(".stage");
  await keypress(stage, "q", { isComposing: true });
  await keypress(stage, "q", { repeat: true });
  await keypress(stage, "q", { altKey: true });
  await keypress(stage, "q", { metaKey: true });
  assert.equal(m.host.querySelector(".save-status.unsaved"), null);
  await keypress(stage, "Q");
  // This input stays mounted independently of the selected mark.
  const otherInput = document.createElement("input");
  m.host.append(otherInput);
  await keypress(otherInput, "s", { ctrlKey: true });
  assert.equal(m.pages.get("a").boxes.length, 1);
});

test("Closed dialog roots do not block save or Q; visible dialogs protect marks", async t => {
  const m = await mount(t);
  await m.click("1 ·");
  const root = document.createElement("div"), wrap = document.createElement("div");
  root.className = "ant-modal-root";
  wrap.className = "ant-modal-wrap";
  root.append(wrap);
  m.host.append(root);
  wrap.getClientRects = () => [{ width: 200, height: 100 }];
  const stage = m.host.querySelector(".stage");
  await keypress(stage, "q");
  assert.equal(m.host.querySelector(".save-status.unsaved"), null);
  wrap.getClientRects = () => [];
  await keypress(stage, "q");
  assert.ok(m.host.querySelector(".save-status.unsaved"));
  await keypress(stage, "s", { metaKey: true });
  assert.equal(m.pages.get("a").boxes.length, 1);
});

test("Crop keyboard save failure keeps the mark deletion undoable", async t => {
  const m = await mount(t, { view: "crops", failSave: true });
  await selectShortcutTarget(m, "crops");
  const target = m.host.querySelector(".crop-results");
  await keypress(target, "q");
  await keypress(target, "s", { metaKey: true });
  assert.ok(m.host.querySelector(".save-status.unsaved"));
  assert.equal(m.pages.get("a").boxes.length, 2);
  assert.equal(m.routes.length, 0);
  await keypress(target, "z", { metaKey: true });
  assert.equal(m.host.querySelector(".save-status.unsaved"), null);
});

test("Focusing a crop selects its Q deletion target without changing view", async t => {
  const m = await mount(t, { view: "crops" });
  const preview = m.host.querySelectorAll(".crop-preview")[1];
  await act(async () => preview.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true })));
  assert.ok(m.host.querySelectorAll(".crop-card")[1].classList.contains("crop-card-selected"));
  await keypress(preview, "q");
  assert.equal(m.host.querySelectorAll(".crop-card").length, 1);
  assert.equal(m.routes.length, 0);
  assert.equal(m.requests.filter(r => r.method !== "GET").length, 0);
});
