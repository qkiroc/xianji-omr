import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { cookieFor, grantFor, request, json, authCli, home, runCli } from "./cli-helpers.mjs";

const boxes = [
  { id: "row", classKey: "system", parentSystemId: null, readingOrder: 0, x: 0, y: 20, width: 200, height: 120 },
  { id: "tab", classKey: "guitar", parentSystemId: "row", readingOrder: 1, x: 10, y: 30, width: 180, height: 50 },
  { id: "words", classKey: "lyrics", parentSystemId: "row", readingOrder: 2, x: 10, y: 100, width: 180, height: 20 },
  { id: "title", classKey: "title", parentSystemId: null, readingOrder: 3, x: 10, y: 0, width: 180, height: 15, metadata: { scope: "page", rawText: "Title" } },
];
async function setup(f) {
  const cookie = await cookieFor(f), grant = await grantFor(f, cookie);
  const api = async (path, options = {}, expected = 200) => {
    const response = await request(f, "/api/v2" + path, { ...options, headers: {
      Authorization: "Bearer " + grant.token, ...options.headers,
    } });
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
  };
  const dataset = await api("/datasets", json({ name: "category export" }), 201);
  const song = await api("/datasets/" + dataset.id + "/songs", json({ name: "train", songGroupKey: "train-group", split: "train" }), 201);
  const upload = async (song, color, annotations = boxes, state = "human") => {
    const data = await sharp({ create: { width: 200, height: 160, channels: 3, background: color } }).png().toBuffer();
    let page = await api("/songs/" + song.id + "/pages", { method: "POST",
      headers: { "Content-Type": "image/png", "X-File-Name": "score.png" }, body: data }, 201);
    page = await api("/pages/" + page.image.id, json({ version: page.image.version, annotationFormat: "layout-v2", boxes: annotations }, "PUT"));
    if (state !== "draft") page = await api("/pages/" + page.image.id + "/confirm",
      json({ version: page.image.version, acknowledged: true, reviewType: state }));
    return page;
  };
  const configHome = await home();
  assert.equal((await authCli(f, cookie, configHome)).code, 0);
  const cli = async (args, expected = 0, input) => {
    const result = await runCli(f, args, { configHome, input });
    assert.equal(result.code, expected, result.stderr);
    return result.value;
  };
  return { api, dataset, song, upload, cli };
}
function inspectZip(path) {
  const script = `import json,zipfile,sys,struct
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('manifest.json'))
 result={'manifest':m,'paths':z.namelist(),'report':json.loads(z.read('integrity-report.json'))}
 if 'annotations.coco.json' in z.namelist():
  result['coco']=json.loads(z.read('annotations.coco.json'))
  result['yaml']=z.read('data.yaml').decode()
  result['labels']=[z.read(n).decode() for n in z.namelist() if n.startswith('labels/')]
 if 'sources.json' in z.namelist():
  result['crops']=json.loads(z.read('sources.json'))
  result['sizes']=[list(struct.unpack('>II',z.read(c['path'])[16:24])) for c in result['crops']]
 print(json.dumps(result))
`;
  const result = spawnSync("python3", ["-c", script, path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function validateZips(...paths) {
  const result = spawnSync("python3", [new URL("../tools/validate-export.py", import.meta.url).pathname, ...paths], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test("Class-filtered immutable snapshots produce matching YOLO, COCO and crops without unrelated labels", async t => {
  const f = await fixture({ port: 55517 }); t.after(() => f.close());
  const s = await setup(f);
  await s.upload(s.song, "#ffaaaa");
  const title = await s.upload(s.song, "#ffffff", [boxes[3]]);
  await s.upload(s.song, "#eeeeee", boxes, "draft");
  await s.upload(s.song, "#dddddd", boxes, "ai");
  const val = await s.api("/datasets/" + s.dataset.id + "/songs", json({ name: "val", songGroupKey: "val-group", split: "val" }), 201);
  await s.upload(val, "#aaaaff");
  const directory = await mkdtemp(join(tmpdir(), "omr-category-packages-"));
  const snapshot = await s.cli(["snapshots", "create", "--dataset", s.dataset.id, "--classes", "lyrics,guitar"]);
  await f.app.locals.platform.exporter.idle();
  const info = await s.cli(["snapshots", "get", snapshot.id]);
  assert.equal(info.status, "ready");
  assert.deepEqual(info.selection.classKeys, ["guitar", "lyrics"]);
  assert.equal(info.stats.sourcePages, 2);
  assert.equal(info.stats.uniqueBoxes, 4);
  assert.ok(!JSON.stringify(info).includes("omr/"), "Metadata does not expose OSS keys");
  for (const kind of ["detection", "crops"]) await s.cli(["snapshots", "download", snapshot.id, "--kind", kind, "--output", join(directory, kind + ".zip")]);
  validateZips(join(directory, "detection.zip"), join(directory, "crops.zip"));
  const detection = inspectZip(join(directory, "detection.zip")), crops = inspectZip(join(directory, "crops.zip"));
  assert.deepEqual(detection.manifest.categories.map(c => [c.key, c.id, c.cocoId, c.sourceId]), [["guitar", 0, 1, 1], ["lyrics", 1, 2, 3]]);
  assert.deepEqual(detection.coco.categories.map(c => c.name), ["guitar", "lyrics"]);
  assert.ok(detection.labels.every(text => text.trim().split("\n").length === 2));
  assert.ok(detection.labels.every(text => text.split("\n").filter(Boolean).map(line => line.split(" ")[0]).join(",") === "0,1"));
  assert.ok(!detection.yaml.includes("system") && !detection.yaml.includes("title"));
  assert.deepEqual(detection.manifest.images.map(i => i.split).sort(), ["train", "val"]);
  assert.ok(detection.manifest.images.every(i => i.boxes.length === 2 && i.contextBoxes.length === 1 && i.contextBoxes[0].classKey === "system"));
  assert.deepEqual(crops.sizes.sort((a, b) => a[1] - b[1]), [[180, 20], [180, 20], [180, 50], [180, 50]]);
  assert.equal(crops.manifest.datasetFingerprint, detection.manifest.datasetFingerprint);
  assert.equal(crops.crops.length, 4);
  assert.ok(crops.crops.every(c => ["guitar", "lyrics"].includes(c.classKey) && c.parentSystemId === "row"));
  const direct = await s.cli(["datasets", "export", s.dataset.id, "--classes", "guitar", "--output", join(directory, "guitar.zip")]);
  const only = inspectZip(direct.path);
  validateZips(direct.path);
  assert.deepEqual(only.manifest.categories.map(c => c.key), ["guitar"]);
  assert.equal(only.crops.length, 2);
  const stored = (await f.pool.query("SELECT frozen,artifacts FROM omr_snapshots WHERE id=$1", [direct.snapshotId])).rows[0];
  assert.deepEqual(Object.keys(stored.artifacts), ["crops"]);
  await s.api("/snapshots/" + direct.snapshotId + "/detection", {}, 404);
  assert.ok(stored.frozen.images.every(i => i.boxes.length === 4), "Frozen source geometry is preserved");
  assert.deepEqual(only.manifest.images.map(i => i.boxes.length), [1, 1]);
  assert.ok((await readFile(direct.path)).length > 0);
  const titles = await s.cli(["datasets", "export", s.dataset.id, "--classes", "title", "--kind", "detection", "--output", join(directory, "titles.zip")]);
  validateZips(titles.path);
  const titlePack = inspectZip(titles.path);
  assert.deepEqual(titlePack.manifest.categories.map(c => c.key), ["title"]);
  assert.equal(titlePack.coco.annotations.length, 3);
  assert.equal(titlePack.report.cropCount, 0, "Detection-only export skips crop rendering");
  assert.deepEqual(Object.keys((await s.cli(["snapshots", "get", titles.snapshotId])).artifacts), ["detection"]);
  await s.cli(["snapshots", "download", direct.snapshotId, "--classes", "guitar", "--kind", "crops", "--output", join(directory, "wrong.zip")], 2);
  for (const body of [{ classKeys: [] }, { classKeys: ["unknown"] }, { classKeys: ["guitar", "guitar"] }, { artifactKinds: ["native"] },
    { classKeys: ["guitar"], pageIds: [title.image.id] }])
    await s.api("/datasets/" + s.dataset.id + "/snapshots", json(body), 400);
  await s.api("/snapshots/invalid", {}, 400);
  await s.api("/snapshots/99999999-9999-4999-8999-999999999999", {}, 404);
});

test("Category export includes more than 200 source pages without truncation and preserves duplicate aliases", async t => {
  const f = await fixture({ port: 55518 }); t.after(() => f.close());
  const s = await setup(f), page = await s.upload(s.song, "#aaffaa");
  await f.pool.query(`INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,boxes,version,song_id,page_order,annotation_format,annotation_version,status,page_type,coordinate,source)
    SELECT gen_random_uuid(),i.object_key||'/alias/'||n,i.original_name,i.mime,i.width,i.height,i.checksum,i.boxes,i.version,i.song_id,n,
      i.annotation_format,i.annotation_version,i.status,i.page_type,i.coordinate,i.source
    FROM omr_images i CROSS JOIN generate_series(2,202)n WHERE i.id=$1`, [page.image.id]);
  await s.api("/datasets/" + s.dataset.id + "/snapshots", json({}), 400);
  const directory = await mkdtemp(join(tmpdir(), "omr-category-large-"));
  const result = await s.cli(["datasets", "export", s.dataset.id, "--classes", "guitar", "--output", join(directory, "all-guitar.zip")]);
  validateZips(result.path);
  const pack = inspectZip(result.path);
  assert.equal(pack.manifest.stats.sourcePages, 202);
  assert.equal(pack.manifest.stats.sourceBoxes, 202);
  assert.equal(pack.manifest.stats.uniqueImages, 1);
  assert.equal(pack.manifest.stats.uniqueBoxes, 1);
  assert.equal(pack.manifest.images[0].aliases.length, 202);
  assert.equal(pack.crops.length, 1);
});
