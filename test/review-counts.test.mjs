import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { cookieFor, grantFor, request, json } from "./cli-helpers.mjs";
test("复核数量跨分页、互斥统计，保留搜索/集合范围并独立于状态筛选", async t => {
  const f = await fixture({ port: 55513 }); t.after(() => f.close());
  const grant = await grantFor(f, await cookieFor(f));
  const api = async (path, opts = {}, expected = 200) => {
    const r = await request(f, "/api/v2" + path, { ...opts,
      headers: { Authorization: "Bearer " + grant.token, ...opts.headers } });
    const value = await r.json();
    assert.equal(r.status, expected, JSON.stringify(value));
    return value;
  };
  const ds = await api("/datasets", json({ name: "复核数量" }), 201);
  const image = await sharp({ create: { width: 200, height: 160, channels: 3, background: "white" } }).png().toBuffer();
  const definitions = [
    ["train", "draft"], ["train", "ai_reviewed"], ["train", "confirmed"],
    ["train", "legacy"], ["val", "ai_reviewed"], ["test", "draft"],
  ];
  for (const [i, [split, status]] of definitions.entries()) {
    const song = await api("/datasets/" + ds.id + "/songs", json({ name: "song-" + i, songGroupKey: "counts-" + i, split }), 201);
    const p = await api("/songs/" + song.id + "/pages", { method: "POST", headers: {
      "Content-Type": "image/png", "X-File-Name": "scope-" + i + ".png",
    }, body: image }, 201);
    await f.pool.query("UPDATE omr_images SET status=$2,annotation_format=$3 WHERE id=$1",
      [p.image.id, status === "legacy" ? "draft" : status, status === "legacy" ? "legacy" : "layout-v1"]);
  }
  const list = q => api("/datasets/" + ds.id + "/pages?pageSize=25&" + q);
  const all = await list("");
  assert.deepEqual(all.reviewCounts, { total: 6, draft: 2, ai_reviewed: 2, confirmed: 1, legacy: 1 });
  assert.equal(all.reviewCounts.total, Object.entries(all.reviewCounts).filter(([key]) => key !== "total").reduce((n, [, v]) => n + v, 0));
  const filtered = await list("split=train&status=ai_reviewed");
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.reviewCounts, { total: 4, draft: 1, ai_reviewed: 1, confirmed: 1, legacy: 1 });
  assert.equal(filtered.items[0].split, "train");
  assert.equal((await list("split=train&status=draft")).total, 1, "Legacy is a distinct queue");
  const page2 = await list("page=2");
  assert.deepEqual(page2.items, []);
  assert.deepEqual(page2.reviewCounts, all.reviewCounts);
  assert.deepEqual((await list("search=scope-4")).reviewCounts,
    { total: 1, draft: 0, ai_reviewed: 1, confirmed: 0, legacy: 0 });
  assert.deepEqual((await list("search=no-such-page")).reviewCounts,
    { total: 0, draft: 0, ai_reviewed: 0, confirmed: 0, legacy: 0 });
});
