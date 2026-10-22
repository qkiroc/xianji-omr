import { cropRectangle } from "./crop-rules.ts";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import yazl from "yazl";
import { categoriesFor, TAXONOMY, digest, stable, need } from "./annotation.ts";
import { freezeSnapshot } from "./snapshots.ts";
const MAX_BYTES = 512 * 1024 * 1024,
  EXPORT_LOCK = 79142603;
const ext = (m: any) =>
  (
    ({
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    }) as Record<string, string>
  )[m];
const publicCoordinate = (c: any) => ({
  version: c.version,
  transform: c.transform,
  orientation: c.orientation,
  original: { ...c.original, key: undefined },
  working: { ...c.working, key: undefined },
});
export async function hashFile(file: any) {
  const h = createHash("sha256");
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest("hex");
}
export async function buildPackages({
  snapshotId,
  frozen,
  storage,
  directory,
  onProgress = async () => {},
}: any) {
  const categoryList = categoriesFor(frozen.taxonomyVersion);
  let bytes = 0;
  const checksums: Record<string, Record<string, string>> = {
      detection: {},
      crops: {},
    },
    paths: Record<string, string[]> = { detection: [], crops: [] };
  async function save(kind: any, path: any, data: any) {
    bytes += Buffer.byteLength(data);
    need(bytes <= MAX_BYTES, "导出临时文件超过512MB，请减少本批页数或框数");
    const dest = join(directory, kind, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data, { mode: 0o600 });
    checksums[kind][path] = digest(data);
    paths[kind].push(path);
  }
  const images: any[] = [],
    annotations: any[] = [],
    native: any[] = [],
    cropMap: any[] = [];
  let annotationId = 1,
    imageId = 1;
  const categories = categoryList.map((c: any) => ({
    id: c.cocoId,
    name: c.key,
    supercategory: c.key === "system" ? "system" : "region",
  }));
  for (const image of frozen.images) {
    const { coordinate: c } = image,
      original = await storage.get(c.original.key);
    need(
      original.length === c.original.bytes &&
        digest(original) === c.original.checksum,
      "来源原图校验失败",
    );
    const work =
      c.working.key === c.original.key
        ? original
        : await storage.get(c.working.key);
    need(
      work.length === c.working.bytes && digest(work) === c.working.checksum,
      "工作图校验失败",
    );
    const m = await sharp(work, { limitInputPixels: 50000000 }).metadata();
    need(
      m.width === c.working.width &&
        m.height === c.working.height &&
        (!m.orientation || m.orientation === 1),
      "工作图尺寸或方向不匹配",
    );
    const path = `images/${image.split}/${image.id}.${ext(c.working.mime)}`,
      sourcePath =
        c.working.key === c.original.key
          ? path
          : `originals/${image.id}.${ext(c.original.mime)}`;
    await save("detection", path, work);
    if (sourcePath !== path) await save("detection", sourcePath, original);
    const labels = image.boxes
      .map((b: any) => {
        const id = categoryList.find((c: any) => c.key === b.classKey)!.id;
        return [
          id,
          (b.x + b.width / 2) / m.width,
          (b.y + b.height / 2) / m.height,
          b.width / m.width,
          b.height / m.height,
        ]
          .map((v: any, i: any) => (i ? v.toFixed(12) : v))
          .join(" ");
      })
      .join("\n");
    await save(
      "detection",
      `labels/${image.split}/${image.id}.txt`,
      labels + (labels ? "\n" : ""),
    );
    images.push({
      id: imageId,
      file_name: path,
      width: m.width,
      height: m.height,
    });
    const item = {
      id: image.id,
      imageId,
      split: image.split,
      pageType: image.pageType,
      annotationFormat: image.annotationFormat || TAXONOMY,
      path,
      originalPath: sourcePath,
      coordinate: publicCoordinate(c),
      boxes: image.boxes,
      aliases: image.aliases,
    };
    native.push(item);
    let cropPixels = 0;
    for (let index = 0; index < image.boxes.length; index++) {
      const b = image.boxes[index];
      cropPixels += b.width * b.height;
      need(cropPixels <= 200000000, "单页裁片总像素超过2亿，请减少重叠区域");
      const file = `crops/${image.split}/${image.id}/${String(index + 1).padStart(4, "0")}.png`,
        dest = join(directory, "crops", file);
      await mkdir(dirname(dest), { recursive: true });
      await sharp(work, { limitInputPixels: 50000000 })
        .extract(cropRectangle(b, m.width, m.height))
        .png()
        .toFile(dest);
      bytes += (await stat(dest)).size;
      need(bytes <= MAX_BYTES, "导出临时文件超过512MB，请减少本批页数或框数");
      checksums.crops[file] = await hashFile(dest);
      paths.crops.push(file);
      cropMap.push({
        path: file,
        sourceImageId: image.id,
        sourcePath: path,
        sourceChecksum: c.original.checksum,
        workingChecksum: c.working.checksum,
        coordinateVersion: c.version,
        split: image.split,
        regionId: b.id,
        classKey: b.classKey,
        parentSystemId: b.parentSystemId,
        box: { x: b.x, y: b.y, width: b.width, height: b.height },
        readingOrder: b.readingOrder,
        ...(b.metadata !== undefined ? { metadata: b.metadata } : {}),
      });
      annotations.push({
        id: annotationId++,
        image_id: imageId,
        category_id: categoryList.find((c: any) => c.key === b.classKey)!
          .cocoId,
        bbox: [b.x, b.y, b.width, b.height],
        area: b.width * b.height,
        iscrowd: 0,
        ...(b.metadata !== undefined ? { metadata: b.metadata } : {}),
      });
    }
    imageId++;
    await onProgress(Math.round(((imageId - 1) / frozen.images.length) * 80));
  }
  await save(
    "detection",
    "annotations.coco.json",
    JSON.stringify({ images, annotations, categories }, null, 2),
  );
  await save(
    "detection",
    "annotations.native.json",
    JSON.stringify(native, null, 2),
  );
  await save(
    "detection",
    "data.yaml",
    `path: .\ntrain: images/train\nval: ${frozen.images.some((i: any) => i.split === "val") ? "images/val" : "null"}\ntest: ${frozen.images.some((i: any) => i.split === "test") ? "images/test" : "null"}\nnames:\n` +
      categoryList.map((c: any) => `  ${c.id}: ${c.key}\n`).join(""),
  );
  await save("crops", "sources.json", JSON.stringify(cropMap, null, 2));
  const base = {
    schemaVersion: 2,
    snapshotId,
    datasetId: frozen.dataset.id,
    task: "layout",
    taxonomyVersion: frozen.taxonomyVersion || TAXONOMY,
    categories: categoryList,
    images: native,
    songs: frozen.songs,
    splits: Object.fromEntries(
      ["train", "val", "test"].map((s: any) => [
        s,
        native.filter((i: any) => i.split === s).map((i: any) => i.id),
      ]),
    ),
    sourceRevisions: native.flatMap((i: any) => i.aliases),
    stats: frozen.stats,
    warnings: frozen.warnings,
    contentTruth: "region-localization-only",
    allFileChecksums: checksums,
  };
  const { snapshotId: ignored, ...identity } = base;
  const datasetFingerprint = digest(stable(identity));
  const report = {
    stats: frozen.stats,
    warnings: frozen.warnings,
    validation:
      "checksums, integer pixels, taxonomy, topology and splits validated",
    cropCount: cropMap.length,
    temporaryBytes: bytes,
  };
  const artifacts: Record<string, any> = {};
  let manifest;
  for (const kind of ["detection", "crops"]) {
    manifest = {
      ...base,
      artifact: kind,
      fileChecksums: checksums[kind],
      datasetFingerprint,
    };
    await writeFile(
      join(directory, kind, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    await writeFile(
      join(directory, kind, "integrity-report.json"),
      JSON.stringify(report, null, 2),
    );
    const zip = new yazl.ZipFile(),
      file = join(directory, kind + ".zip");
    const output = pipeline(
      zip.outputStream,
      createWriteStream(file, { mode: 0o600 }),
    );
    for (const path of [
      ...paths[kind],
      "manifest.json",
      "integrity-report.json",
    ])
      zip.addFile(join(directory, kind, path), path, {
        mtime: new Date("2020-01-01T00:00:00Z"),
        mode: 0o100600,
      });
    zip.end();
    await output;
    const size = (await stat(file)).size;
    need(size <= MAX_BYTES, "压缩包超过512MB");
    artifacts[kind] = { file, bytes: size, checksum: await hashFile(file) };
  }
  return { artifacts, manifest: { ...base, datasetFingerprint }, report };
}
export function createExporter({ pool, storage, config }: any) {
  let busy = false;
  const running = new Set();
  let ready: Promise<void> | undefined;
  async function recover() {
    if (!ready)
      ready = (async () => {
        const c = await pool.connect();
        let locked = false;
        try {
          locked = (
            await c.query("SELECT pg_try_advisory_lock($1) ok", [EXPORT_LOCK])
          ).rows[0].ok;
          if (locked)
            await c.query(
              "UPDATE omr_snapshots SET status='failed',error='进程重启中断，请重试同一冻结快照' WHERE status='preparing'",
            );
        } finally {
          if (locked)
            await c.query("SELECT pg_advisory_unlock($1)", [EXPORT_LOCK]);
          c.release();
        }
      })();
    return ready;
  }
  async function process(snapshot: any, c: any) {
    let directory;
    const uploaded: any[] = [];
    try {
      directory = await mkdtemp(join(tmpdir(), "xianji-omr-export-"));
      const built = await buildPackages({
        snapshotId: snapshot.id,
        frozen: snapshot.frozen,
        storage,
        directory,
        onProgress: (p: any) =>
          pool.query("UPDATE omr_snapshots SET progress=$1 WHERE id=$2", [
            p,
            snapshot.id,
          ]),
      });
      const artifacts: Record<string, any> = {};
      for (const [kind, a] of Object.entries(built.artifacts)) {
        const key =
          config.oss.prefix +
          "snapshots/" +
          snapshot.id +
          "/" +
          randomUUID() +
          "/" +
          kind +
          ".zip";
        await storage.putStream(
          key,
          createReadStream(a.file),
          "application/zip",
        );
        uploaded.push(key);
        artifacts[kind] = { key, bytes: a.bytes, checksum: a.checksum };
      }
      await pool.query(
        "UPDATE omr_snapshots SET status='ready',manifest=$1,artifacts=$2,progress=100,error=NULL,completed_at=now() WHERE id=$3",
        [built.manifest, artifacts, snapshot.id],
      );
    } catch (e: any) {
      for (const key of uploaded)
        await storage
          .delete(key)
          .catch(() => console.error("EXPORT_COMPENSATION_FAILED"));
      await pool
        .query(
          "UPDATE omr_snapshots SET status='failed',error=$1 WHERE id=$2",
          [
            e.status ? e.message : "导出处理失败，原图与标注未改动；可重试",
            snapshot.id,
          ],
        )
        .catch(() => {});
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      await c
        .query("SELECT pg_advisory_unlock($1)", [EXPORT_LOCK])
        .catch(() => {});
      c.release();
      busy = false;
      running.delete(snapshot.id);
    }
  }
  async function launch(datasetId: any, snapshotId: any, options: any = {}) {
    await recover();
    need(!busy, "已有导出正在进行，请稍后重试", 409);
    busy = true;
    const c = await pool.connect();
    let locked = false;
    try {
      locked = (
        await c.query("SELECT pg_try_advisory_lock($1) ok", [EXPORT_LOCK])
      ).rows[0].ok;
      need(locked, "其他实例正在导出", 409);
      let snapshot;
      if (snapshotId) {
        snapshot = (
          await c.query(
            "SELECT id,frozen,status FROM omr_snapshots WHERE id=$1",
            [snapshotId],
          )
        ).rows[0];
        need(snapshot?.status === "failed", "只有失败快照可以重试", 409);
        await c.query(
          "UPDATE omr_snapshots SET status='preparing',progress=0,error=NULL WHERE id=$1",
          [snapshotId],
        );
      } else snapshot = await freezeSnapshot(pool, datasetId, options);
      running.add(snapshot.id);
      void process(snapshot, c);
      return snapshot.id;
    } catch (e: any) {
      if (locked) await c.query("SELECT pg_advisory_unlock($1)", [EXPORT_LOCK]);
      c.release();
      busy = false;
      throw e;
    }
  }
  return {
    recover,
    launch,
    async idle() {
      while (running.size) await new Promise((r: any) => setTimeout(r, 20));
    },
  };
}
