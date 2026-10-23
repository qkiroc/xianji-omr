import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertToast } from "../shared/toast-state.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import ts from "typescript";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
test("toast重复不延长停留，关闭不重弹，同类去重且最多四条", () => {
  const dismissed = new Set();
  let s = upsertToast(
    [],
    { owner: "a", text: "失败", content: "action" },
    dismissed,
    100,
  );
  assert.equal(s[0].expires, 10100);
  s = upsertToast(
    s,
    { owner: "a", text: "失败", content: "new action" },
    dismissed,
    1000,
  );
  assert.equal(s[0].expires, 10100);
  assert.equal(s[0].content, "new action");
  assert.equal(
    upsertToast(s, { owner: "b", text: "失败" }, dismissed, 1200),
    s,
  );
  dismissed.add("a失败");
  assert.deepEqual(
    upsertToast([], { owner: "a", text: "失败" }, dismissed, 1300),
    [],
  );
  for (let i = 0; i < 8; i++)
    s = upsertToast(
      s,
      { owner: String(i), text: "error" + i },
      dismissed,
      1400,
    );
  assert.equal(s.length, 4);
  assert.deepEqual(
    upsertToast(s, { owner: "7", text: "" }, dismissed, 1500).map(
      (n) => n.owner,
    ),
    ["4", "5", "6"],
  );
});
const compiled = new Map();
const output = new URL("../.test-data/ui-compiled/", import.meta.url);
await mkdir(output, { recursive: true });
async function compile(file) {
  if (compiled.has(file)) return compiled.get(file);
  const target = new URL(
    createHash("sha256").update(file).digest("hex") + ".mjs",
    output,
  );
  compiled.set(file, target.href);
  let code = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const matches = [...code.matchAll(/from\s+["']([^"']+)["']/g)];
  for (const m of matches) {
    let dest;
    if (m[1].startsWith(".")) {
      let base = resolve(dirname(file), m[1]);
      for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
        try {
          await readFile(base + ext);
          dest = await compile(base + ext);
          break;
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      if (!dest) throw Error("Missing module " + base);
    } else dest = pathToFileURL(require.resolve(m[1])).href;
    code = code.replace(m[0], m[0].replace(m[1], dest));
  }
  await writeFile(target, code);
  return target.href;
}
test("真实裁片组件：四种小区域网格，其余一行；无总览/逐框复核/底部操作", async () => {
  const url = await compile(
    fileURLToPath(new URL("../components/layout/results.tsx", import.meta.url)),
  );
  const { LayoutCrops } = await import(url);
  const {
    SearchParamsContext,
  } = require("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
  const classes = [
    "title",
    "capo",
    "key_signature",
    "time_signature",
    "performer",
    "tempo",
    "chord_marks",
    "system",
  ];
  const doc = {
    image: { width: 200, height: 200, status: "confirmed" },
    boxes: classes.map((classKey, i) => ({
      id: "region" + i,
      classKey,
      x: 0,
      y: i * 10,
      width: 50,
      height: 10,
      metadata: { rawText: classKey === "capo" ? "Capo=0" : undefined },
      reviewStatus: "confirmed",
    })),
    deletedBoxes: [],
  };
  const html = renderToStaticMarkup(
    createElement(
      SearchParamsContext.Provider,
      { value: new URLSearchParams("cropReview=confirmed") },
      createElement(LayoutCrops, {
        doc,
        taxonomy: classes.map((key) => ({ key, name: key, color: "#123456" })),
        dirty: true,
        onAdjust() {},
        onRestore() {},
        stateRef: {
          current: { category: "", status: "confirmed", scroll: 0, size: 200 },
        },
      }),
    ),
  );
  assert.equal((html.match(/class="crop-card wide"/g) || []).length, 4);
  assert.equal((html.match(/class="crop-card "/g) || []).length, 4);
  assert.equal((html.match(/aria-label="调整选区 /g) || []).length, 8);
  for (const removed of [
    "原图总览",
    "裁片复核状态",
    "确认无误",
    "标记需调整",
    "查看大图",
    "icon-actions",
  ])
    assert.ok(!html.includes(removed), removed);
  assert.ok(html.includes("Capo=0"));
  assert.ok(html.includes("当前未保存修改"));
  assert.ok(html.includes("#123456"));
});
