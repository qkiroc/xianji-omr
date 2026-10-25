import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { cookieFor, grantFor, request, json } from "./cli-helpers.mjs";
import {SCHEMA, withLock, migrate, checkHistory } from "../server/src/migrate.mjs";
import { reviewWindow } from "../shared/review-trend.ts";

async function setup(f) {
  const cookie = await cookieFor(f), grant = await grantFor(f, cookie);
  const api = async (path, opts = {}, expected = 200, web = false) => {
    const r = await request(f, "/api/v2" + path, { ...opts, headers: {
      ...(web ? { Cookie: cookie } : { Authorization: "Bearer " + grant.token }), ...opts.headers,
    } });
    const result = await r.json();
    assert.equal(r.status, expected, JSON.stringify(result));
    return result;
  };
  const ds = await api("/datasets", json({ name: "人工审核趋势" }), 201);
  const song = await api("/datasets/" + ds.id + "/songs",
    json({ name: "train song", songGroupKey: ds.id + "-train", split: "train" }), 201);
  const image = await sharp({ create: { width: 200, height: 160, channels: 3, background: "white" } }).png().toBuffer();
  const upload = async (name, source = "") => {
    let p = await api("/songs/" + song.id + "/pages", {
      method: "POST", headers: { "Content-Type": "image/png", "X-File-Name": name }, body: image,
    }, 201);
    return api("/pages/" + p.image.id, json({ version: p.image.version, annotationFormat: "layout-v2", source,
      boxes: [{ id: "root", classKey: "system", parentSystemId: null, readingOrder: 0, x: 0, y: 0, width: 200, height: 160 }],
    }, "PUT"));
  };
  return { api, ds, song, upload };
}
test("Human review history survives edits, deduplicates daily, and excludes AI and automated synthetic confirmation", async t => {
  const f = await fixture({ port: 55514 }); t.after(() => f.close());
  const { api, ds, upload } = await setup(f);
  const list = () => api("/datasets/" + ds.id + "/pages?trendDays=7&status=draft");
  const confirm = (p, type = "human", web = false) => api("/pages/" + p.image.id + "/confirm",
    json({ version: p.image.version, acknowledged: true, reviewType: type }), 200, web);
  let p = await upload("manual.png");
  const updated = p.image.updatedAt;
  p = await confirm(p);
  assert.ok(p.image.updatedAt >= updated);
  p = await confirm(p);
  assert.equal((await list()).reviewTrend.total, 1, "Repeated confirmation is one page/day");
  const history = (await f.pool.query("SELECT human_reviews FROM omr_images WHERE id=$1", [p.image.id])).rows[0].human_reviews;
  assert.equal(Object.keys(history).length, 1);
  assert.equal(Object.values(history)[0].estimated, false);
  await api("/pages/" + p.image.id + "/confirm", json({ version: p.image.version - 1, acknowledged: true }), 409);
  await api("/pages/" + p.image.id + "/confirm", json({ version: p.image.version, acknowledged: false }), 400);
  p = await api("/pages/" + p.image.id + "/unconfirm", json({ version: p.image.version }));
  p = await api("/pages/" + p.image.id, json({ version: p.image.version, annotationFormat: "layout-v2", boxes: p.boxes }, "PUT"));
  await f.pool.query("UPDATE omr_images SET updated_at='2001-01-01T00:00:00Z' WHERE id=$1", [p.image.id]);
  const listed = await list();
  assert.equal(listed.reviewTrend.total, 1, "Later changes do not move the historical review date");
  assert.equal(new Date(listed.items[0].updatedAt).toISOString(), "2001-01-01T00:00:00.000Z");
  const ai = await confirm(await upload("ai.png"), "ai");
  let synthetic = await confirm(await upload("synthetic.png", "synthetic:batch:test"));
  assert.equal((await list()).reviewTrend.total, 1);
  synthetic = await confirm(synthetic, "human", true);
  assert.equal((await list()).reviewTrend.total, 2, "A real browser review of a synthetic page counts");
  assert.deepEqual((await f.pool.query("SELECT human_reviews FROM omr_images WHERE id=$1", [ai.image.id])).rows[0].human_reviews, {});
  const preview = await api("/deletions/preview", json({ kind: "page", ids: [synthetic.image.id] }));
  await api("/deletions/execute", json({ token: preview.token, acknowledged: true }));
  assert.equal((await list()).reviewTrend.total, 1, "History is removed with the deleted source page");
});

test("Daily trend covers all filtered pages across pagination and statuses, fills zeros and validates ranges", async t => {
  const f = await fixture({ port: 55515 }); t.after(() => f.close());
  const { api, ds, song } = await setup(f);
  const val = await api("/datasets/" + ds.id + "/songs", json({ name: "val song", songGroupKey: ds.id + "-val", split: "val" }), 201);
  const { end: today, start: yesterday } = reviewWindow(2);
  await f.pool.query(`INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,song_id,page_order,source,status,annotation_format,human_reviews)
    SELECT gen_random_uuid(),'omr/trend-'||n,'scope-'||n||'.png','image/png',200,160,repeat('a',64),
      CASE WHEN n=32 THEN $2::uuid ELSE $1::uuid END,n,'scan',
      CASE WHEN n%2=0 THEN 'confirmed' ELSE 'draft' END,'layout-v1',
      jsonb_build_object($3::text,jsonb_build_object('estimated',false)) FROM generate_series(1,32)n`,
    [song.id, val.id, today]);
  await f.pool.query(`UPDATE omr_images SET human_reviews=human_reviews||jsonb_build_object($2::text,jsonb_build_object('estimated',true)) WHERE song_id=$1 AND page_order=1`, [song.id, yesterday]);
  const list = q => api("/datasets/" + ds.id + "/pages?trendDays=7&pageSize=25&" + q);
  const all = await list("");
  assert.equal(all.items.length, 25);
  assert.equal(all.reviewTrend.total, 33);
  assert.equal(all.reviewTrend.points.length, 7);
  assert.equal(all.reviewTrend.points.at(-1).count, 32);
  assert.equal(all.reviewTrend.points.at(-2).count, 1);
  assert.equal(all.reviewTrend.estimated, 1);
  assert.equal(all.reviewTrend.points[0].count, 0);
  assert.deepEqual((await list("page=2&status=draft")).reviewTrend, all.reviewTrend);
  assert.equal((await list("split=train")).reviewTrend.total, 32);
  assert.equal((await list("split=val")).reviewTrend.total, 1);
  assert.equal((await list("search=scope-32")).reviewTrend.total, 1);
  assert.equal((await list("search=no-match")).reviewTrend.total, 0);
  assert.equal((await api("/datasets/" + ds.id + "/pages?trendDays=90")).reviewTrend.points.length, 90);
  await api("/datasets/" + ds.id + "/pages?trendDays=8", {}, 400);
  await api("/datasets/" + ds.id + "/pages?trendDays=30 OR 1=1", {}, 400);
});

test("Schema 8 backfills only eligible historical human confirmations, explicitly as estimates, and is idempotent", async t => {
  const f = await fixture({ port: 55516, migrationVersion: 7 }); t.after(() => f.close());
  const { api, ds, song } = await setup(f);
  await f.pool.query(`INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,song_id,page_order,status,annotation_format,source,updated_at,version)
    SELECT gen_random_uuid(),'omr/backfill-'||n,'history-'||n,'image/png',200,160,repeat('a',64),$1,n,
      CASE WHEN n=3 THEN 'ai_reviewed' WHEN n=4 THEN 'draft' ELSE 'confirmed' END,
      CASE WHEN n=5 THEN 'legacy' ELSE 'layout-v1' END,
      CASE WHEN n=2 THEN 'synthetic:old' ELSE 'scan' END,'2026-01-01T16:01:00Z',9
    FROM generate_series(1,5)n`, [song.id]);
  const before = (await f.pool.query("SELECT id,version,boxes,updated_at FROM omr_images ORDER BY id")).rows;
  await withLock(f.pool, c => migrate(c));
  await withLock(f.pool, c => migrate(c));
  assert.equal(await checkHistory(f.pool), SCHEMA);
  assert.deepEqual((await f.pool.query("SELECT id,version,boxes,updated_at FROM omr_images ORDER BY id")).rows, before);
  const rows = (await f.pool.query("SELECT page_order,human_reviews FROM omr_images ORDER BY page_order")).rows;
  assert.deepEqual(Object.keys(rows[0].human_reviews), ["2026-01-02"]);
  assert.equal(rows[0].human_reviews["2026-01-02"].estimated, true);
  assert.ok(rows.slice(1).every(r => Object.keys(r.human_reviews).length === 0));
  assert.equal((await api("/datasets/" + ds.id + "/pages")).items.length, 5);
});
