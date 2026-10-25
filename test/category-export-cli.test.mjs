import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { snapshotSelection, exportDataset } from "../tools/cli/src/export.mjs";

const datasetId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222";
test("Class CSV merges with page selection and rejects ambiguous or malformed categories", () => {
  assert.deepEqual(snapshotSelection({ pageIds: [datasetId] }, "guitar, lyrics"), { pageIds: [datasetId], classKeys: ["guitar", "lyrics"] });
  for (const value of ["", "guitar,", "guitar,guitar", "../guitar"])
    assert.throws(() => snapshotSelection({}, value), /类别/);
  assert.throws(() => snapshotSelection({ classKeys: ["guitar"] }, "lyrics"), /只能选择一种/);
  assert.throws(() => snapshotSelection({ classKeys: null }), /类别/);
});
test("One-command export waits for the exact snapshot and checks its ZIP checksum before publishing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omr-category-cli-")), output = join(directory, "guitar.zip");
  const bytes = Buffer.from("isolated zip payload"), checksum = createHash("sha256").update(bytes).digest("hex");
  const calls = [], events = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.endsWith("/taxonomy")) return Response.json({ categories: [{ key: "guitar" }] });
    if (options.method === "POST") {
      assert.deepEqual(JSON.parse(options.body), { classKeys: ["guitar"], artifactKinds: ["crops"] });
      return Response.json({ id: snapshotId });
    }
    if (path.endsWith("/crops")) return new Response(bytes, { headers: {
      "x-checksum-sha256": checksum, "content-length": String(bytes.length),
    } });
    return Response.json({ id: snapshotId, datasetId, status: "ready", progress: 100,
      selection: { classKeys: ["guitar"] }, artifacts: { crops: { checksum } } });
  };
  const result = await exportDataset({ request, datasetId, selection: snapshotSelection({}, "guitar"), output, progress: e => events.push(e) });
  assert.equal(result.snapshotId, snapshotId);
  assert.equal(result.checksum, checksum);
  assert.deepEqual(await readFile(output), bytes);
  assert.deepEqual(await readdir(directory), ["guitar.zip"]);
  assert.ok(events.some(e => e.event === "export-created"));
  assert.ok(calls.some(c => c.path === "/api/v2/snapshots/" + snapshotId));
  const before = calls.length;
  await assert.rejects(exportDataset({ request, datasetId, output, progress() {} }), { code: "EXISTS" });
  assert.equal(calls.length, before, "Existing files fail before creating a new server export");
});
test("Unknown classes fail before snapshot creation; failed exports leave no output file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omr-category-errors-")), output = join(directory, "none.zip");
  let posts = 0;
  const request = async (path, options = {}) => {
    if (path.endsWith("/taxonomy")) return Response.json({ categories: [{ key: "guitar" }] });
    if (options.method === "POST") { posts++; return Response.json({ id: snapshotId }); }
    return Response.json({ id: snapshotId, datasetId, status: "failed", error: "isolated failure" });
  };
  await assert.rejects(exportDataset({ request, datasetId, selection: { classKeys: ["unknown"] }, output, progress() {} }), { code: "CLASS" });
  assert.equal(posts, 0);
  await assert.rejects(exportDataset({ request, datasetId, output, progress() {} }), { code: "EXPORT_FAILED" });
  assert.deepEqual(await readdir(directory), []);
});
test("Waiting timeout preserves the server snapshot ID and creates no partial archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omr-category-timeout-")), output = join(directory, "none.zip");
  const request = async (path, options = {}) => Response.json(options.method === "POST" ? { id: snapshotId } :
    { id: snapshotId, datasetId, status: "preparing", progress: 1 });
  await assert.rejects(exportDataset({ request, datasetId, output, timeout: 1, progress() {} }), e => e.code === "EXPORT_TIMEOUT" && e.message.includes(snapshotId));
  assert.deepEqual(await readdir(directory), []);
});
