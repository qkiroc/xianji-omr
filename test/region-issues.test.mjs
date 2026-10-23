import { test } from "node:test";
import assert from "node:assert/strict";
import { regionIssues } from "../shared/region-issues.ts";
import { songEditorTarget } from "../shared/editor-navigation.ts";
const parent = {
  id: "p",
  classKey: "system",
  parentSystemId: null,
  x: 10,
  y: 20,
  width: 100,
  height: 60,
};
const child = {
  id: "c",
  classKey: "guitar",
  parentSystemId: "p",
  x: 10,
  y: 20,
  width: 100,
  height: 60,
};
test("包含校验边界与服务端一致；无父页级元信息不强制关联；修正后消失", () => {
  assert.deepEqual(regionIssues([parent, child]), []);
  const bad = { ...child, x: 9 };
  assert.equal(regionIssues([parent, bad])[0].boxId, "c");
  assert.equal(regionIssues([parent, bad])[0].parentId, "p");
  for (const b of [
    { ...child, y: 19 },
    { ...child, width: 101 },
    { ...child, height: 61 },
  ])
    assert.equal(regionIssues([parent, b]).length, 1);
  assert.deepEqual(
    regionIssues([parent, { ...bad, parentSystemId: null, classKey: "title" }]),
    [],
  );
  assert.deepEqual(regionIssues([parent, { ...bad, x: 10 }]), []);
});
test("父框被缩小/丢失/类型错误时指向对应子框ID，不按列表位置推断", () => {
  assert.equal(regionIssues([{ ...parent, width: 50 }, child])[0].boxId, "c");
  assert.equal(regionIssues([child])[0].boxId, "c");
  assert.equal(
    regionIssues([child, { ...parent, classKey: "melody" }])[0].boxId,
    "c",
  );
  assert.deepEqual(regionIssues([child, parent]), []);
});
test("歌曲导航保留筛选页码与视图、清除前页框ID，并支持空歌曲入口", () => {
  const target = songEditorTarget(
    "dataset",
    { id: "next", first_page_id: "first" },
    "search=歌曲&page=3&split=train&view=crops&box=old",
  );
  const url = new URL(target, "http://test");
  assert.equal(url.pathname, "/datasets/dataset/songs/next/pages/first");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("search"), "歌曲");
  assert.equal(url.searchParams.get("view"), "crops");
  assert.equal(url.searchParams.get("split"), "train");
  assert.equal(url.searchParams.has("box"), false);
  assert.equal(
    songEditorTarget("dataset", { id: "empty", first_page_id: null }, ""),
    "/datasets/dataset/songs/empty",
  );
});
