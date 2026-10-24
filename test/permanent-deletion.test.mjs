import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { localizationSetup } from "./localization-helpers.mjs";
import { json, grantFor } from "./cli-helpers.mjs";
const setup = async (t, port) => {
  const f = await fixture({ port });
  t.after(() => f.close());
  const s = await localizationSetup(f);
  return {
    f,
    s,
    preview: (kind, ids, regionIds) =>
      s.api(
        "/deletions/preview",
        json({ kind, ids, ...(regionIds ? { regionIds } : {}) }),
      ),
  };
};
test("永久级联：原图/工作图、跨定位数据与完整冻结包删除，其他数据保留，重复执行幂等", async (t) => {
  const { f, s, preview } = await setup(t, 55470);
  const imported = await s.api(
    "/localization/datasets/" + s.loc.id + "/import",
    json(s.payload),
  );
  // Immutable snapshots may be destroyed only by the dedicated service.
  const ls = (
    await f.pool.query(
      "INSERT INTO omr_loc_snapshots(id,dataset_id,frozen,fingerprint) VALUES(gen_random_uuid(),$1,$2,'test') RETURNING id",
      [s.loc.id, { records: [{ id: imported.record.id }] }],
    )
  ).rows[0];
  await assert.rejects(
    f.pool.query("DELETE FROM omr_loc_snapshots WHERE id=$1", [ls.id]),
    /immutable/,
  );
  const key = "omr/snapshots/test.zip";
  await f.storage.put(key, Buffer.from("frozen"));
  const snap = (
    await f.pool.query(
      "INSERT INTO omr_snapshots(id,dataset_id,frozen,status,artifacts) VALUES(gen_random_uuid(),$1,$2,'ready',$3) RETURNING id",
      [s.dataset.id, { images: [{ id: s.page.image.id }] }, { crops: { key } }],
    )
  ).rows[0];
  const other = await s.api("/datasets", json({ name: "保留数据" }), 201);
  const p = await preview("page", [s.page.image.id]);
  assert.equal(p.summary.localizationRecords, 1);
  assert.equal(p.summary.snapshots, 2);
  assert.ok(p.summary.objects >= 2);
  await s.api("/deletions/execute", json({ token: p.token }), 400);
  const read = await grantFor(f, s.cookie, { scopes: ["data:read"] });
  await s.api(
    "/deletions/execute",
    json({ token: p.token, acknowledged: true }),
    403,
    read.token,
  );
  const result = await s.api(
    "/deletions/execute",
    json({ token: p.token, acknowledged: true }),
  );
  assert.equal(result.deleted, true);
  for (const table of [
    "omr_images",
    "omr_loc_records",
    "omr_loc_record_pages",
    "omr_snapshots",
    "omr_loc_snapshots",
  ])
    assert.equal(
      Number((await f.pool.query("SELECT count(*) n FROM " + table)).rows[0].n),
      0,
      table,
    );
  assert.equal(f.objects.size, 0);
  assert.ok(
    (await f.pool.query("SELECT id FROM omr_datasets WHERE id=$1", [other.id]))
      .rowCount,
  );
  assert.equal(
    (
      await s.api(
        "/deletions/execute",
        json({ token: p.token, acknowledged: true }),
      )
    ).deleted,
    true,
  );
  await s.api(
    "/datasets/" + s.dataset.id + "/restore",
    json({ version: 1 }),
    410,
  );
});
test("故障：部分OSS已删不伪报成功、持久任务阻止写入、重试完成；预览过期/版本冲突不删除", async (t) => {
  const { f, s, preview } = await setup(t, 55471);
  let p = await preview("page", [s.page.image.id]);
  await f.pool.query("UPDATE omr_images SET version=version+1 WHERE id=$1", [
    s.page.image.id,
  ]);
  await s.api(
    "/deletions/execute",
    json({ token: p.token, acknowledged: true }),
    409,
  );
  assert.equal(f.objects.size, 1);
  p = await preview("page", [s.page.image.id]);
  await f.pool.query(
    "UPDATE omr_deletion_jobs SET created_at=now()-interval '10 minutes' WHERE id=$1",
    [p.token],
  );
  await s.api(
    "/deletions/execute",
    json({ token: p.token, acknowledged: true }),
    409,
  );
  const extra = "omr/extra-working";
  await f.storage.put(extra, Buffer.from("work"));
  await f.pool.query(
    "UPDATE omr_images SET coordinate=jsonb_set(coordinate,'{working,key}',to_jsonb($1::text)) WHERE id=$2",
    [extra, s.page.image.id],
  );
  p = await preview("page", [s.page.image.id]);
  const del = f.storage.delete;
  let calls = 0;
  f.storage.delete = async (k) => {
    if (++calls === 2) throw Error("simulated");
    await del(k);
  };
  await s.api(
    "/deletions/execute",
    json({ token: p.token, acknowledged: true }),
    503,
  );
  assert.equal((await f.pool.query("SELECT id FROM omr_images")).rowCount, 1);
  assert.equal((await s.api("/deletions")).length, 1);
  await s.api("/datasets", json({ name: "不应创建" }), 503);
  await grantFor(f, s.cookie); // Browser CLI authorization remains available while cleanup is pending.
  f.storage.delete = del;
  const result = await s.api("/deletions/" + p.token + "/retry", json({}));
  assert.equal(result.deleted, true);
  assert.equal(f.objects.size, 0);
  assert.equal((await s.api("/deletions")).length, 0);
});
test("区域JSON保存删除与专用清理：原图保留、版本校验与数据集删除", async (t) => {
  const { f, s, preview } = await setup(t, 55472);
  const box = {
    id: "line",
    classKey: "system",
    parentSystemId: null,
    readingOrder: 0,
    x: 0,
    y: 0,
    width: 200,
    height: 160,
  };
  const page = await s.api(
    "/pages/" + s.page.image.id,
    json(
      {
        version: s.page.image.version,
        annotationFormat: "layout-v2",
        boxes: [box],
      },
      "PUT",
    ),
  );
  const edited = await s.api(
    "/pages/" + page.image.id,
    json(
      { version: page.image.version, annotationFormat: "layout-v2", boxes: [] },
      "PUT",
    ),
  );
  assert.deepEqual(edited.boxes, []);
  assert.equal(f.objects.size, 1);
  await s.api(
    "/pages/" + page.image.id,
    json({ version: page.image.version, annotationFormat: "layout-v2", boxes: [box] }, "PUT"),
    409,
  );
  await s.api(
    "/pages/" + page.image.id,
    json({ version: edited.image.version, annotationFormat: "layout-v2", boxes: [box] }, "PUT"),
  );
  const p = await preview("region", [page.image.id], ["line"]);
  await s.api(
    "/deletions/execute",
    json({ token: p.token, acknowledged: true }),
  );
  const clean = await s.api("/pages/" + page.image.id);
  assert.deepEqual(clean.boxes, []);
  assert.deepEqual(clean.deletedBoxes, []);
  assert.equal(f.objects.size, 1);
  await s.api(
    "/pages/" + page.image.id + "/regions/line/restore",
    json({ version: clean.image.version }),
    410,
  );
  const d = await preview("dataset", [s.dataset.id]);
  await s.api(
    "/deletions/execute",
    json({ token: d.token, acknowledged: true }),
  );
  assert.equal(f.objects.size, 0);
  assert.equal(
    (
      await f.pool.query("SELECT id FROM omr_datasets WHERE id=$1", [
        s.dataset.id,
      ])
    ).rowCount,
    0,
  );
});
test("数据库清理失败不伪报成功，进程级新清理服务从持久任务重试；无关表不被清理", async (t) => {
  const { f, s, preview } = await setup(t, 55473);
  const p = await preview("page", [s.page.image.id]);
  const del = f.storage.delete;
  let once = false;
  f.storage.delete = async (key) => {
    await del(key);
    if (!once) {
      once = true;
      await f.pool.query(
        "CREATE TABLE isolated_blocker(id uuid REFERENCES omr_images(id))",
      );
      await f.pool.query("INSERT INTO isolated_blocker VALUES($1)", [
        s.page.image.id,
      ]);
    }
  };
  await s.api(
    "/deletions/execute",
    json({ token: p.token, acknowledged: true }),
    503,
  );
  assert.equal(f.objects.size, 0);
  assert.equal((await f.pool.query("SELECT id FROM omr_images")).rowCount, 1);
  assert.equal(
    (await f.pool.query("SELECT * FROM isolated_blocker")).rowCount,
    1,
  );
  await f.pool.query("DROP TABLE isolated_blocker");
  f.storage.delete = del;
  const { createDeletionService } = await import("../server/src/deletion.ts");
  await createDeletionService({
    pool: f.pool,
    storage: f.storage,
    config: f.config,
  }).recover();
  assert.equal((await f.pool.query("SELECT id FROM omr_images")).rowCount, 0);
  assert.equal((await s.api("/deletions")).length, 0);
});
test("定位小节和数据集永久删除：清空只读来源对应小节/关联快照，保留共享原图", async (t) => {
  const { f, s, preview } = await setup(t, 55474);
  const imported = await s.api(
    "/localization/datasets/" + s.loc.id + "/import",
    json(s.payload),
  );
  const record = imported.record;
  const ev = record.geometry.measures[0].events[0].id;
  const ep = await preview("locEvent", [record.id], [ev]);
  await s.api(
    "/deletions/execute",
    json({ token: ep.token, acknowledged: true }),
  );
  const noEvent = await s.api("/localization/records/" + record.id);
  assert.equal(noEvent.geometry.measures[0].events.length, 0);
  assert.equal(noEvent.original.measures[0].events.length, 0);
  const id = record.geometry.measures[0].id;
  const plan = await preview("locMeasure", [record.id], [id]);
  assert.equal(plan.summary.measures, 1);
  await s.api(
    "/deletions/execute",
    json({ token: plan.token, acknowledged: true }),
  );
  const changed = await s.api("/localization/records/" + record.id);
  assert.equal(changed.geometry.measures.length, 0);
  assert.ok(!changed.original.measures.some((m) => m.id === id));
  assert.equal(changed.status, "draft");
  assert.equal(f.objects.size, 1);
  const p = await preview("locDataset", [s.loc.id]);
  await s.api(
    "/deletions/execute",
    json({ token: p.token, acknowledged: true }),
  );
  assert.equal(
    (await f.pool.query("SELECT * FROM omr_loc_records")).rowCount,
    0,
  );
  assert.equal(
    (await f.pool.query("SELECT * FROM omr_loc_datasets")).rowCount,
    0,
  );
  assert.equal(f.objects.size, 1);
  assert.ok((await s.api("/pages/" + s.page.image.id)).image);
});
test("永久删除输入/权限/Origin及对象前缀保护：拒绝危险请求且不触碰OSS", async (t) => {
  const { f, s, preview } = await setup(t, 55475);
  const { request } = await import("./cli-helpers.mjs");
  const bad = await request(f, "/api/v2/deletions/preview", {
    ...json({ kind: "page", ids: [s.page.image.id] }),
    headers: {
      Cookie: s.cookie,
      Origin: "https://evil.invalid",
      "Content-Type": "application/json",
    },
  });
  assert.equal(bad.status, 403);
  const read = await grantFor(f, s.cookie, { scopes: ["data:read"] });
  await s.api(
    "/deletions/preview",
    json({ kind: "page", ids: [s.page.image.id] }),
    403,
    read.token,
  );
  await s.api(
    "/deletions/preview",
    json({ kind: "omr_images;DROP TABLE x", ids: [s.page.image.id] }),
    400,
  );
  await f.pool.query(
    "UPDATE omr_images SET object_key='other-application/private' WHERE id=$1",
    [s.page.image.id],
  );
  await s.api(
    "/deletions/preview",
    json({ kind: "page", ids: [s.page.image.id] }),
    409,
  );
  assert.equal(f.objects.size, 1);
  assert.equal(
    (await f.pool.query("SELECT id FROM omr_deletion_jobs")).rowCount,
    0,
  );
});
