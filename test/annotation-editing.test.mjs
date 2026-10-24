import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { localizationSetup } from "./localization-helpers.mjs";
import { json } from "./cli-helpers.mjs";
test("保存删除区域/小节/事件只更新JSON，保留原图、定位来源附件和冻结快照", async t => {
  const f = await fixture({ port: 55511 }); t.after(() => f.close());
  const s = await localizationSetup(f);
  const imported = await s.api("/localization/datasets/" + s.loc.id + "/import", json(s.payload));
  const original = structuredClone(imported.record.original);
  let page = await s.api("/pages/" + s.page.image.id, json({
    version: s.page.image.version, annotationFormat: "layout-v2",
    boxes: [{ id: "root", classKey: "system", parentSystemId: null,
      readingOrder: 0, x: 0, y: 0, width: 200, height: 160 }],
  }, "PUT"));
  const frozen = { images: [structuredClone(page)] };
  const snapshot = (await f.pool.query(
    "INSERT INTO omr_snapshots(id,dataset_id,frozen,status) VALUES(gen_random_uuid(),$1,$2,'pending') RETURNING id",
    [s.dataset.id, frozen],
  )).rows[0];
  page = await s.api("/pages/" + page.image.id, json({
    version: page.image.version, annotationFormat: "layout-v2", boxes: [],
  }, "PUT"));
  assert.deepEqual(page.boxes, []);
  assert.deepEqual(page.deletedBoxes, []);
  assert.equal(f.objects.size, 1);
  assert.deepEqual((await f.pool.query("SELECT frozen FROM omr_snapshots WHERE id=$1", [snapshot.id])).rows[0].frozen, frozen);
  let record = imported.record;
  const oldVersion = record.version;
  const geometry = structuredClone(record.geometry);
  geometry.measures[0].events = [];
  record = await s.api("/localization/records/" + record.id,
    json({ version: record.version, geometry }, "PUT"));
  assert.deepEqual(record.geometry.measures[0].events, []);
  assert.deepEqual(record.original, original);
  record = await s.api("/localization/records/" + record.id,
    json({ version: record.version, geometry: { ...record.geometry, measures: [] } }, "PUT"));
  assert.deepEqual(record.geometry.measures, []);
  assert.deepEqual(record.original, original);
  await s.api("/localization/records/" + record.id,
    json({ version: oldVersion, geometry }, "PUT"), 409);
  assert.equal(f.objects.size, 1);
  assert.equal((await f.pool.query("SELECT id FROM omr_deletion_jobs")).rowCount, 0);
});
