import { registerDeletion } from "./deletion.ts";
import { registerLocalization } from "./localization/api.ts";
import { registerRegionReview } from "./region-review.ts";
import { registerSongCatalogue } from "./song-catalogue.ts";
import { registerCatalogue } from "./catalogue.ts";
import express from "express";
import {
  CATEGORIES,
  TAXONOMY,
  LATEST_TAXONOMY,
  categoriesFor,
  need,
  ID,
} from "./annotation.ts";
import { registerDatasets } from "./datasets.ts";
import { registerPages } from "./pages.ts";
import { createExporter } from "./exporter.ts";
import { pipeline } from "node:stream/promises";
export function createPlatform(deps: any) {
  const router = express.Router() as express.Router & {
      exporter: ReturnType<typeof createExporter>;
    },
    exporter = createExporter(deps),
    { pool, storage } = deps;
  router.exporter = exporter;
  // Router-specific parser leaves image streams to the upload handler.
  router.use((req: any, res: any, next: any) => {
    if (req.method === "POST" && /^\/songs\/[^/]+\/pages$/.test(req.path))
      return next();
    express.json({ limit: "2mb" })(req, res, next);
  });
  router.get("/taxonomy", (req: any, res: any) => {
    need(
      !req.query.version ||
        [TAXONOMY, LATEST_TAXONOMY].includes(req.query.version),
      "类别版本无效",
    );
    const version = req.query.version || LATEST_TAXONOMY;
    res.json({ taxonomyVersion: version, categories: categoriesFor(version) });
  });
  const deletion = registerDeletion(router, deps);
  (router as any).deletion = deletion;
  registerLocalization(router, deps);
  registerDatasets(router, deps);
  registerSongCatalogue(router, { pool });
  registerCatalogue(router, deps);
  registerPages(router, deps);
  registerRegionReview(router, deps);
  router.get("/datasets/:datasetId/snapshots", async (req: any, res: any) => {
    need(ID.test(req.params.datasetId), "数据集ID无效");
    res.json(
      (
        await pool.query(
          "SELECT id,status,progress,error,created_at,completed_at,frozen->'stats' AS stats,frozen->'warnings' AS warnings,frozen->'selection' AS selection,artifacts,manifest->>'datasetFingerprint' AS dataset_fingerprint FROM omr_snapshots WHERE dataset_id=$1 ORDER BY created_at DESC LIMIT 30",
          [req.params.datasetId],
        )
      ).rows.map((r: any) => ({
        id: r.id,
        status: r.status,
        progress: r.progress,
        error: r.error,
        createdAt: r.created_at,
        stats: r.stats,
        warnings: r.warnings,
        selection: r.selection || undefined,
        datasetFingerprint: r.dataset_fingerprint || undefined,
        artifacts: r.artifacts
          ? Object.fromEntries(
              Object.entries(r.artifacts).map(([k, v]: any) => [
                k,
                { bytes: v.bytes, checksum: v.checksum },
              ]),
            )
          : null,
      })),
    );
  });
  router.post("/datasets/:datasetId/snapshots", async (req: any, res: any) =>
    res.status(202).json({
      id: await exporter.launch(req.params.datasetId, null, {
        pageIds: req.body.pageIds,
        classKeys: req.body.classKeys,
        artifactKinds: req.body.artifactKinds,
      }),
    }),
  );
  router.get("/snapshots/:snapshotId", async (req: any, res: any) => {
    need(ID.test(req.params.snapshotId), "快照ID无效");
    const snapshot = (await pool.query(
      "SELECT id,dataset_id,status,progress,error,frozen->'stats' AS stats,frozen->'selection' AS selection,artifacts FROM omr_snapshots WHERE id=$1",
      [req.params.snapshotId],
    )).rows[0];
    need(snapshot, "快照不存在", 404);
    res.json({
      id: snapshot.id, datasetId: snapshot.dataset_id, status: snapshot.status,
      progress: snapshot.progress, error: snapshot.error, stats: snapshot.stats,
      selection: snapshot.selection || undefined,
      artifacts: snapshot.artifacts ? Object.fromEntries(Object.entries(snapshot.artifacts).map(([kind, value]: any) =>
        [kind, { bytes: value.bytes, checksum: value.checksum }])) : null,
    });
  });
  router.post("/snapshots/:snapshotId/retry", async (req: any, res: any) => {
    need(ID.test(req.params.snapshotId), "快照ID无效");
    res
      .status(202)
      .json({ id: await exporter.launch(null, req.params.snapshotId) });
  });
  router.get("/snapshots/:snapshotId/:kind", async (req: any, res: any) => {
    need(
      ID.test(req.params.snapshotId) &&
        ["detection", "crops"].includes(req.params.kind),
      "下载标识无效",
    );
    const r = (
      await pool.query(
        "SELECT status,artifacts FROM omr_snapshots WHERE id=$1",
        [req.params.snapshotId],
      )
    ).rows[0];
    need(r?.status === "ready", "快照尚未准备好，不能下载", 409);
    const asset = r.artifacts[req.params.kind];
    need(asset, "此快照未生成该类型的导出包", 404);
    const stream = await storage.getStream(asset.key);
    res.type("application/zip").set({
      "Content-Disposition": `attachment; filename="${req.params.snapshotId}-${req.params.kind}.zip"`,
      "Content-Length": String(asset.bytes),
      "X-Checksum-Sha256": asset.checksum,
    });
    await pipeline(stream, res);
  });
  return router;
}
