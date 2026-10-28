import { test, after } from "node:test";
after(() => window.happyDOM.abort());
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { fileURLToPath } from "node:url";
import { compile } from "./compile-ui.mjs";
const window = new Window({ url: "http://localhost/" });
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "ShadowRoot",
  "HTMLInputElement",
  "HTMLFormElement",
  "HTMLButtonElement",
  "MutationObserver",
  "ResizeObserver",
  "getComputedStyle",
  "FormData",
  "File",
  "Event",
  "MouseEvent",
  "SubmitEvent",
  "SVGElement",
])
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value:
      name === "window"
        ? window
        : typeof window[name] === "function" && name === "getComputedStyle"
          ? window[name].bind(window)
          : window[name],
  });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const ui = await import(
  await compile(
    fileURLToPath(new URL("../components/ui/antd.tsx", import.meta.url)),
  )
);
const { UiProvider } = await import(
  await compile(
    fileURLToPath(new URL("../components/ui/provider.tsx", import.meta.url)),
  )
);
const { confirmAction } = await import(
  await compile(fileURLToPath(new URL("../shared/dialog.ts", import.meta.url)))
);
const h = React.createElement;
async function mount(content) {
  let closed = false;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(h(UiProvider, null, content)));
  return {
    host,
    async close() {
      if (closed) return;
      closed = true;
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
const click = async (el) =>
  act(async () =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
  );
test("Antd实际控件：表单FormData、Select/Checkbox、InputNumber、表格行操作隔离", async (t) => {
  let submitted,
    changes = [],
    rowClicks = 0,
    actions = 0;
  const tree = h(
    React.Fragment,
    null,
    h(
      ui.Form,
      {
        onSubmit: (e) => {
          e.preventDefault();
          submitted = Object.fromEntries(new window.FormData(e.currentTarget));
        },
      },
      h(ui.Input, { name: "title", defaultValue: "谱页", required: true }),
      h(
        ui.Select,
        { name: "split", defaultValue: "train" },
        h("option", { value: "train" }, "训练"),
        h("option", { value: "val" }, "验证"),
      ),
      h(ui.Input, { type: "checkbox", name: "agree", defaultChecked: true }),
      h(ui.Input, {
        type: "number",
        name: "count",
        defaultValue: 2,
        onChange: (e) => changes.push(e.target.value),
      }),
      h(ui.Button, null, "保存"),
    ),
    h(
      ui.Table,
      null,
      h(
        ui.TableHead,
        null,
        h(ui.TableRow, null, h(ui.TableHeading, null, "操作")),
      ),
      h(
        ui.TableBody,
        null,
        h(
          ui.TableRow,
          { onClick: () => rowClicks++ },
          h(
            ui.TableCell,
            { onClick: (e) => e.stopPropagation() },
            h(ui.Button, { onClick: () => actions++ }, "删除"),
          ),
        ),
      ),
    ),
  );
  const m = await mount(tree);
  t.after(() => m.close());
  assert.ok(m.host.querySelector(".ant-form"));
  assert.equal(m.host.querySelector("form").method, "post");
  assert.ok(m.host.querySelector(".ant-select"));
  assert.ok(m.host.querySelector(".ant-checkbox"));
  assert.ok(m.host.querySelector(".ant-input-number"));
  assert.ok(m.host.querySelector(".ant-table"));
  await act(async () =>
    m.host
      .querySelector("form")
      .dispatchEvent(
        new window.SubmitEvent("submit", { bubbles: true, cancelable: true }),
      ),
  );
  assert.equal(submitted.title, "谱页");
  assert.equal(submitted.split, "train");
  assert.equal(submitted.agree, "on");
  assert.equal(submitted.count, "2");
  await click(
    [...m.host.querySelectorAll("button")].find(
      (b) => b.textContent.replace(/\s/g, "") === "删除",
    ),
  );
  assert.equal(actions, 1);
  assert.equal(rowClicks, 0);
});
test("Antd Modal取代浏览器confirm：取消/确认Promise及界面就绪保护", async (t) => {
  const m = await mount(h("div", null, "ready"));
  t.after(() => m.close());
  let result;
  await act(async () => {
    result = confirmAction("永久删除测试");
  });
  assert.ok(document.querySelector(".ant-modal-confirm"));
  await click(
    [
      ...[...document.querySelectorAll(".ant-modal-confirm")]
        .at(-1)
        .querySelectorAll("button"),
    ].find((b) => b.textContent.replace(/\s/g, "") === "取消"),
  );
  assert.equal(await result, false);
  await act(async () => {
    result = confirmAction("确认测试");
  });
  await click(
    [
      ...[...document.querySelectorAll(".ant-modal-confirm")]
        .at(-1)
        .querySelectorAll("button"),
    ].find((b) => b.textContent.replace(/\s/g, "") === "确定"),
  );
  assert.equal(await result, true);
  await m.close();
  await assert.rejects(confirmAction("not mounted"), /尚未准备/);
});
test("Antd Upload实际文件事件一次传递原始文件，不自动请求上传", async (t) => {
  let received,
    called = 0;
  const m = await mount(
    h(ui.Input, {
      type: "file",
      multiple: true,
      accept: "image/png",
      onChange: (e) => {
        received = [...e.target.files];
        called++;
      },
    }),
  );
  t.after(() => m.close());
  const input = m.host.querySelector("input[type=file]");
  assert.ok(input);
  const files = [
    new window.File(["png-a"], "a.png", { type: "image/png" }),
    new window.File(["png-b"], "b.png", { type: "image/png" }),
  ];
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () =>
    input.dispatchEvent(new window.Event("change", { bubbles: true })),
  );
  assert.equal(called, 1);
  assert.deepEqual(
    received.map((f) => f.name),
    ["a.png", "b.png"],
  );
  assert.equal(await received[0].text(), "png-a");
});

test("Antd Select异步选项可提交，必填错误走通知而非浏览器校验气泡", async (t) => {
  let submitted = 0;
  function Content() {
    const [loaded, setLoaded] = React.useState(false);
    return h(
      ui.Form,
      {
        onSubmit: (e) => {
          e.preventDefault();
          submitted++;
        },
      },
      h(
        ui.Select,
        { name: "song", id: "upload-song" },
        loaded ? h("option", { value: "song-uuid" }, "歌曲") : null,
      ),
      h(ui.Input, { name: "required", required: true }),
      h(ui.Button, { type: "button", onClick: () => setLoaded(true) }, "加载"),
    );
  }
  const m = await mount(h(Content));
  t.after(() => m.close());
  await click(
    [...m.host.querySelectorAll("button")].find(
      (b) => b.textContent === "加载",
    ),
  );
  assert.equal(document.getElementById("upload-song").value, "song-uuid");
  const form = m.host.querySelector("form");
  assert.equal(form.noValidate, true);
  await act(async () =>
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.equal(submitted, 0);
  assert.ok(document.querySelector(".ant-notification-notice-error"));
});

test("Antd通知同来源新错误更新内容，不保留旧提示", async (t) => {
  const { ToastHost } = await import(
    await compile(
      fileURLToPath(new URL("../components/ui/toast.tsx", import.meta.url)),
    )
  );
  const m = await mount(h(ToastHost));
  t.after(() => m.close());
  for (const text of ["第一条错误", "新的错误内容"]) {
    await act(async () =>
      window.dispatchEvent(
        new window.CustomEvent("omr-toast", {
          detail: { owner: "test-error", text, content: text },
        }),
      ),
    );
  }
  assert.match(
    document.querySelector(".ant-notification").textContent,
    /新的错误内容/,
  );
  assert.doesNotMatch(
    document.querySelector(".ant-notification").textContent,
    /第一条错误/,
  );
});
