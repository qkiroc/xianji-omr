import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { request, json, grantFor } from "./cli-helpers.mjs";
import { localizationSetup } from "./localization-helpers.mjs";
import { fingerprint } from "../server/src/localization/geometry.ts";
const sha = (b) => createHash("sha256").update(b).digest("hex");
test("定位真实PG：不同页ID映射、来源完整附件、精度、幂等、AI不自动确认、错误来源/split拒绝", async (t) => {
  const f = await fixture({ port: 55460 });
  t.after(() => f.close());
  const s = await localizationSetup(f),
    path = "/localization/datasets/" + s.loc.id + "/import";
  const imported = await s.api(path, json(s.payload));
  assert.equal(imported.idempotent, false);
  const r = imported.record;
  assert.deepEqual(r.original, s.corpus);
  assert.equal(r.geometry.pages[0].sourcePageId, s.page.image.id);
  assert.equal(r.geometry.measures[0].geometryConfirmed, false);
  assert.equal(r.geometry.measures[0].events[0].centerX, 50.125);
  assert.equal(r.geometry.measures[0].staffLines[0], 20.125);
  assert.equal(r.status, "draft");
  assert.equal((await s.api(path, json(s.payload))).idempotent, true);
  const conflict = structuredClone(s.payload);
  conflict.corpus.measures[0].review_note = "different";
  await s.api(path, json(conflict), 409);
  const wrong = structuredClone(s.payload);
  wrong.sourcePageMap["different-local-page"] =
    "00000000-0000-4000-8000-000000000099";
  await s.api(path, json(wrong), 410);
  wrong.sourcePageMap = s.payload.sourcePageMap;
  wrong.corpus.source.pages[0].sha256 = "0".repeat(64);
  await s.api(path, json(wrong), 409);
  wrong.corpus = s.corpus;
  wrong.corpus = { ...s.corpus, split: "val" };
  await s.api(path, json(wrong), 409);
  const extra = structuredClone(r.geometry);
  extra.measures[0].label = { unsupported: "must not silently discard" };
  await s.api(
    "/localization/records/" + r.id,
    json({ version: r.version, geometry: extra }, "PUT"),
    400,
  );
  assert.equal(f.objects.size, 1);
  assert.equal(
    (
      await s.api(
        "/localization/datasets/" +
          s.loc.id +
          "/records?source=image_proposals_reference_separate_v1",
      )
    ).total,
    1,
  );
  const otherSong = await s.api(
      "/datasets/" + s.dataset.id + "/songs",
      json({
        name: "重复原图",
        songGroupKey: "other-original-group",
        split: "val",
      }),
      201,
    ),
    otherPage = await s.api(
      "/songs/" + otherSong.id + "/pages",
      {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: s.bytes,
      },
      201,
    ),
    leak = structuredClone(s.payload);
  leak.corpus.source.sample_id = "other-corpus";
  leak.corpus.source.group_id = "other-original-group";
  leak.corpus.split = "val";
  leak.sourcePageMap["different-local-page"] = otherPage.image.id;
  await s.api(path, json(leak), 409);
});
test("定位真实PG：版本冲突、草稿未知几何、人工确认/撤销/局部失效、拒绝恢复和scopes", async (t) => {
  const f = await fixture({ port: 55461 });
  t.after(() => f.close());
  const s = await localizationSetup(f);
  let r = (
    await s.api(
      "/localization/datasets/" + s.loc.id + "/import",
      json(s.payload),
    )
  ).record;
  const path = "/localization/records/" + r.id;
  const write = await grantFor(f, s.cookie, {
    scopes: ["data:read", "data:write"],
  });
  await s.api(
    path + "/confirm",
    json({ version: r.version, acknowledged: true }),
    403,
    write.token,
  );
  await s.api(path + "/confirm", json({ version: r.version }), 400);
  f.fail.get = true;
  await s.api(
    path + "/confirm",
    json({ version: r.version, acknowledged: true }),
    503,
  );
  assert.equal((await s.api(path)).status, "draft");
  f.fail.get = false;
  r = await s.api(
    path + "/confirm",
    json({ version: r.version, acknowledged: true }),
  );
  assert.equal(r.status, "confirmed");
  const g = structuredClone(r.geometry);
  g.measures.push({
    ...g.measures[0],
    id: "measure2",
    events: [{ ...g.measures[0].events[0], id: "event2" }],
  });
  r = await s.api(path, json({ version: r.version, geometry: g }, "PUT"));
  assert.equal(r.geometry.measures[0].geometryConfirmed, true);
  assert.equal(r.geometry.measures[1].geometryConfirmed, false);
  r = await s.api(
    path + "/confirm",
    json({ version: r.version, acknowledged: true }),
  );
  const before = r.version,
    change = structuredClone(r.geometry);
  change.measures[0].events[0].centerX = 51.375;
  const concurrent = await Promise.all([
    request(f, "/api/v2" + path, {
      ...json({ version: before, geometry: change }, "PUT"),
      headers: {
        Authorization: "Bearer " + s.grant.token,
        "Content-Type": "application/json",
      },
    }),
    request(f, "/api/v2" + path, {
      ...json({ version: before, geometry: change }, "PUT"),
      headers: {
        Authorization: "Bearer " + s.grant.token,
        "Content-Type": "application/json",
      },
    }),
  ]);
  assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
  r = await s.api(path);
  assert.equal(r.geometry.measures[0].geometryConfirmed, false);
  assert.equal(r.geometry.measures[1].geometryConfirmed, true);
  r = await s.api(
    path + "/events/event-stable-1/reject",
    json({ version: r.version }),
  );
  assert.equal(r.geometry.measures[0].events[0].status, "rejected");
  r = await s.api(
    path + "/events/event-stable-1/restore",
    json({ version: r.version }),
  );
  assert.equal(r.geometry.measures[0].events[0].status, "candidate");
  const draft = structuredClone(r.geometry);
  draft.measures[0].bbox = null;
  draft.measures[0].staffLines = null;
  draft.measures[0].events[0].centerX = null;
  r = await s.api(path, json({ version: r.version, geometry: draft }, "PUT"));
  await s.api(
    path + "/confirm",
    json({ version: r.version, acknowledged: true }),
    400,
  );
  assert.equal(r.geometry.measures[0].bbox, null);
  const wrong = structuredClone(r.geometry);
  wrong.pages[0].sourceSha = "a".repeat(64);
  await s.api(path, json({ version: r.version, geometry: wrong }, "PUT"), 409);
});
test("编码不同图片必须显式RGB等价映射；错误证明拒绝，冻结原生/裁片SHA不被后续修改", async (t) => {
  const f = await fixture({ port: 55462 });
  t.after(() => f.close());
  const s = await localizationSetup(f),
    payload = structuredClone(s.payload);
  payload.corpus.source.pages[0].sha256 = "f".repeat(64);
  const proof = {
    mode: "decoded-rgb-v1",
    acknowledged: true,
    platformSha256: sha(s.bytes),
    historicalSha256: "f".repeat(64),
    rgbSha256: sha(
      await sharp(s.bytes).removeAlpha().toColourspace("srgb").raw().toBuffer(),
    ),
  };
  payload.pixelEquivalence = { "different-local-page": proof };
  let r = (
    await s.api("/localization/datasets/" + s.loc.id + "/import", json(payload))
  ).record;
  assert.equal(r.geometry.pages[0].historicalSha, "f".repeat(64));
  const changed = structuredClone(r.geometry);
  changed.measures[0].events[0].centerX = 51.875;
  r = await s.api(
    "/localization/records/" + r.id,
    json({ version: r.version, geometry: changed }, "PUT"),
  );
  const bad = structuredClone(payload);
  bad.pixelEquivalence["different-local-page"].rgbSha256 = "0".repeat(64);
  await s.api("/localization/datasets/" + s.loc.id + "/import", json(bad), 409);
  r = await s.api(
    "/localization/records/" + r.id + "/confirm",
    json({ version: r.version, acknowledged: true }),
  );
  const snap = await s.api(
    "/localization/datasets/" + s.loc.id + "/snapshots",
    json({}),
    201,
  );
  const download = await request(
      f,
      "/api/v2/localization/snapshots/" + snap.id + "/native",
      { headers: { Authorization: "Bearer " + s.grant.token } },
    ),
    data = Buffer.from(await download.arrayBuffer());
  assert.equal(download.headers.get("x-checksum-sha256"), sha(data));
  assert.deepEqual(JSON.parse(data).records[0].original, payload.corpus);
  const { fingerprint: exportedFingerprint, ...native } = JSON.parse(data);
  assert.equal(fingerprint(native), exportedFingerprint);
  const target = await s.api(
      "/localization/datasets",
      json({ name: "原生往返" }),
      201,
    ),
    roundtrip = await s.api(
      "/localization/datasets/" + target.id + "/import",
      json({ ...payload, geometry: native.records[0].geometry }),
    );
  assert.deepEqual(roundtrip.record.original, payload.corpus);
  assert.equal(roundtrip.record.geometry.measures[0].events[0].centerX, 51.875);
  assert.equal(roundtrip.record.geometry.measures[0].geometryConfirmed, false);
  assert.equal(roundtrip.record.status, "draft");
  assert.equal(f.objects.size, 1);
  const crops = await request(
      f,
      "/api/v2/localization/snapshots/" + snap.id + "/crops",
      { headers: { Authorization: "Bearer " + s.grant.token } },
    ),
    zip = Buffer.from(await crops.arrayBuffer());
  assert.equal(crops.status, 200);
  assert.equal(crops.headers.get("x-checksum-sha256"), sha(zip));
  assert.ok(zip.length > 100);
  f.fail.get = true;
  const failed = await request(
    f,
    "/api/v2/localization/snapshots/" + snap.id + "/crops",
    { headers: { Authorization: "Bearer " + s.grant.token } },
  );
  assert.equal(failed.status, 503);
  f.fail.get = false;
  const retried = await request(
    f,
    "/api/v2/localization/snapshots/" + snap.id + "/crops",
    { headers: { Authorization: "Bearer " + s.grant.token } },
  );
  assert.equal(retried.status, 200);
  assert.deepEqual(Buffer.from(await retried.arrayBuffer()), zip);
  await assert.rejects(
    f.pool.query("UPDATE omr_loc_snapshots SET fingerprint='x' WHERE id=$1", [
      snap.id,
    ]),
    /immutable/,
  );
  await f.pool.query("UPDATE omr_images SET checksum=$1 WHERE id=$2", [
    "0".repeat(64),
    s.page.image.id,
  ]);
  await s.api("/localization/records/" + r.id, {}, 409);
  assert.equal(
    JSON.parse(data).records[0].geometry.measures[0].events[0].centerX,
    51.875,
  );
});
