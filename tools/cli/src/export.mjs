import { lstat, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fail } from "./input.mjs";
import { jsonBody, limitedJSON } from "./http.mjs";
import { download } from "./download.mjs";

export function snapshotSelection(value = {}, classes) {
  if (classes !== undefined && value.classKeys !== undefined)
    fail("INPUT", "--classes与JSON中的classKeys只能选择一种");
  const keys = classes === undefined ? value.classKeys :
    typeof classes === "string" ? classes.split(",").map((key) => key.trim()) : [];
  if (keys !== undefined && (!Array.isArray(keys) || !keys.length || keys.length > 13 ||
      new Set(keys).size !== keys.length || keys.some((key) => typeof key !== "string" || !/^[a-z][a-z0-9_]*$/.test(key))))
    fail("INPUT", "类别须为不重复的taxonomy key，多个类别用逗号分隔");
  return { ...value, ...(keys === undefined ? {} : { classKeys: keys }) };
}

export async function exportDataset({ request, datasetId, selection = {}, output, kind = "crops", timeout = 900, signal, progress = (value) => process.stderr.write(JSON.stringify(value) + "\n") }) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(datasetId || ""))
    fail("ARGUMENT", "数据集ID无效");
  if (!["crops", "detection"].includes(kind)) fail("ARGUMENT", "--kind仅支持crops或detection");
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600)
    fail("ARGUMENT", "--timeout须为1–3600秒");
  if (!output || typeof output !== "string") fail("OUTPUT", "必须提供--output ZIP路径");
  if (selection.artifactKinds !== undefined) fail("INPUT", "datasets export请使用--kind指定导出类型");
  const final = resolve(output);
  try { await lstat(final); fail("EXISTS", "目标文件已存在，拒绝覆盖", 7); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!(await stat(dirname(final))).isDirectory()) fail("OUTPUT", "输出目录无效", 7);
  if (selection.classKeys) {
    const taxonomy = await limitedJSON(await request("/api/v2/taxonomy"));
    const allowed = taxonomy.categories?.map((c) => c.key) || [];
    const unknown = selection.classKeys.filter((key) => !allowed.includes(key));
    if (unknown.length) fail("CLASS", "未知类别：" + unknown.join(",") + "；可用类别：" + allowed.join(","));
  }
  const created = await limitedJSON(await request("/api/v2/datasets/" + datasetId + "/snapshots",
    jsonBody({ ...selection, artifactKinds: [kind] })));
  if (!/^[a-f0-9-]{36}$/.test(created.id || "")) fail("RESPONSE", "服务端未返回有效快照ID", 6);
  progress({ event: "export-created", snapshotId: created.id, kind });
  const deadline = Date.now() + timeout * 1000;
  let previous;
  for (;;) {
    if (Date.now() >= deadline) fail("EXPORT_TIMEOUT", "打包等待超时；快照 " + created.id + " 可用snapshots get查看并继续下载", 6);
    const snapshot = await limitedJSON(await request("/api/v2/snapshots/" + created.id));
    if (snapshot.id !== created.id || snapshot.datasetId !== datasetId)
      fail("RESPONSE", "快照不属于当前数据集", 6);
    const state = snapshot.status + ":" + snapshot.progress;
    if (state !== previous) {
      progress({ event: "export-progress", snapshotId: created.id, status: snapshot.status, progress: snapshot.progress });
      previous = state;
    }
    if (snapshot.status === "failed") fail("EXPORT_FAILED", snapshot.error || "服务端打包失败，可重试此冻结快照：" + created.id, 6);
    if (snapshot.status === "ready") {
      const artifact = snapshot.artifacts?.[kind];
      if (!artifact) fail("RESPONSE", "快照没有请求的导出包", 6);
      const file = await download(await request("/api/v2/snapshots/" + created.id + "/" + kind), final, artifact.checksum, signal);
      return { snapshotId: created.id, kind, ...(snapshot.selection?.classKeys ? { classKeys: snapshot.selection.classKeys } : {}), ...file };
    }
    if (snapshot.status !== "preparing") fail("RESPONSE", "未知快照状态", 6);
    await delay(Math.min(1000, Math.max(1, deadline - Date.now())), undefined, { signal });
  }
}
