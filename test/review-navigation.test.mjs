import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { compile } from "./compile-ui.mjs";
import {
  reviewQueue, reviewQueueQuery, pageEditorTarget,
  pageTrailKey, readPageTrail, writePageTrail,
} from "../shared/editor-navigation.ts";
const { annotationChanged } = await import(await compile(
  fileURLToPath(new URL("../shared/editor-document.ts", import.meta.url)),
));
test("复核队列固定进入时的状态，并保留搜索、集合及歌曲筛选", () => {
  const query = new URLSearchParams("status=ai_reviewed&search=月&split=train&songId=song&page=3&box=old&view=crops");
  const queue = reviewQueue(query, { status: "ai_reviewed", annotationFormat: "layout-v2" });
  assert.equal(queue, "ai_reviewed");
  const target = new URL(pageEditorTarget("ds", { id: "next", songId: "other" }, query, queue), "http://localhost");
  assert.equal(target.searchParams.get("queue"), "ai_reviewed");
  assert.equal(target.searchParams.get("box"), null);
  assert.equal(target.searchParams.get("page"), "3");
  assert.equal(target.searchParams.get("view"), "crops");
  assert.equal(reviewQueue(target.searchParams, { status: "confirmed", annotationFormat: "layout-v2" }), "ai_reviewed");
  assert.deepEqual(Object.fromEntries(reviewQueueQuery(target.searchParams, queue)), {
    search: "月", split: "train", songId: "song", status: "ai_reviewed",
  });
  assert.equal(reviewQueue(new URLSearchParams(), { status: "draft", annotationFormat: "legacy" }), "legacy");
  assert.equal(reviewQueue(new URLSearchParams("queue=bad"), { status: "draft", annotationFormat: "layout-v2" }), "draft");
});
test("上一页记录与筛选绑定，刷新可恢复，并容忍存储损坏或不可用", () => {
  const values = new Map();
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  const key = pageTrailKey("ds", new URLSearchParams("split=train&page=2"), "ai_reviewed");
  assert.equal(key, pageTrailKey("ds", new URLSearchParams("page=5&split=train&view=crops"), "ai_reviewed"));
  assert.notEqual(key, pageTrailKey("ds", new URLSearchParams("split=val"), "ai_reviewed"));
  writePageTrail(storage, key, [{ id: "now-confirmed", songId: "song" }]);
  assert.deepEqual(readPageTrail(storage, key), [{ id: "now-confirmed", songId: "song" }]);
  values.set(key, '[null,{},{"id":"ok","songId":"s"}]');
  assert.deepEqual(readPageTrail(storage, key), [{ id: "ok", songId: "s" }]);
  values.set(key, "invalid");
  assert.deepEqual(readPageTrail(storage, key), []);
  assert.deepEqual(readPageTrail({ getItem() { throw Error("blocked"); } }, key), []);
  assert.doesNotThrow(() => writePageTrail({ setItem() { throw Error("full"); } }, key, []));
});
test("删框、重做会变脏，撤销回保存基线恢复干净；页类型与元信息也纳入比较", () => {
  const saved = {
    image: { id: "page", pageType: "music" },
    boxes: [{ id: "box", x: 0, y: 1, width: 20, height: 10,
      classKey: "title", parentSystemId: null, readingOrder: 0,
      metadata: { scope: "page", value: { text: "歌名" } }, reviewStatus: "confirmed" }],
    deletedBoxes: [],
  };
  assert.equal(annotationChanged(saved, { ...saved, boxes: [] }), true);
  const restored = structuredClone(saved);
  restored.boxes[0].reviewStatus = "draft";
  assert.equal(annotationChanged(saved, restored), false);
  restored.boxes[0].metadata.value.text = "修改";
  assert.equal(annotationChanged(saved, restored), true);
  assert.equal(annotationChanged(saved, { ...saved, image: { ...saved.image, pageType: "negative" } }), true);
});
