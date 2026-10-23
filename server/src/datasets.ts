import { DELETION_LOCK, deletionBarrier } from "./deletion-lock.ts";
import { randomUUID } from "node:crypto";
import { need, Problem, ID, TAXONOMY } from "./annotation.ts";
export const LEGACY_SONG = "00000000-0000-4000-8000-000000000002";
export async function transaction(
  pool: any,
  fn: any,
  { isolation = "", independentAuth = false }: any = {},
) {
  const c = await pool.connect();
  let deletionHeld = false;
  try {
    if (!independentAuth) {
      await c.query("SELECT pg_advisory_lock_shared($1)", [DELETION_LOCK]);
      deletionHeld = true;
    }
    await c.query("BEGIN" + (isolation ? " ISOLATION LEVEL " + isolation : ""));
    if (!independentAuth) await deletionBarrier(c);
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    if (deletionHeld)
      await c
        .query("SELECT pg_advisory_unlock_shared($1)", [DELETION_LOCK])
        .catch(() => {});
    c.release();
  }
}
export const text = (v: any, max: any = 200) => {
  need(
    typeof v === "string" &&
      v.trim().length > 0 &&
      v.length <= max &&
      !/[\x00-\x1f]/.test(v),
    "名称或分组键不能为空/过长",
  );
  return v.trim();
};
export async function songLock(c: any, dataset: any) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "dataset:" + dataset,
  ]);
}
export async function datasetRecord(
  c: any,
  id: any,
  { deleted = false, lock = false }: any = {},
) {
  need(ID.test(id), "数据集ID无效");
  if (lock) await songLock(c, id);
  const d = (
    await c.query(
      "SELECT * FROM omr_datasets WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
      [id],
    )
  ).rows[0];
  need(d, "数据集不存在", 404);
  if (!deleted) need(!d.deleted_at, "数据集已删除，请先恢复", 410);
  return d;
}
export async function songRecord(c: any, id: any) {
  need(ID.test(id), "曲目标识无效");
  const s = (
    await c.query(
      "SELECT s.*,d.deleted_at AS dataset_deleted FROM omr_songs s JOIN omr_datasets d ON d.id=s.dataset_id WHERE s.id=$1",
      [id],
    )
  ).rows[0];
  need(s, "曲目不存在", 404);
  need(!s.deleted_at, "歌曲已删除，请先恢复", 410);
  need(!s.dataset_deleted, "数据集已删除，请先恢复", 410);
  return s;
}
export function registerDatasets(router: any, { pool }: any) {
  router.get("/datasets", async (req: any, res: any) => {
    need(
      !req.query.deleted || ["active", "deleted"].includes(req.query.deleted),
      "删除状态无效",
    );
    res.json(
      (
        await pool.query(
          `SELECT d.*,count(DISTINCT s.id) FILTER(WHERE s.deleted_at IS NULL)::int song_count,count(i.id) FILTER(WHERE i.deleted_at IS NULL)::int page_count,count(i.id) FILTER(WHERE i.deleted_at IS NULL AND i.status='confirmed')::int confirmed_count,COALESCE(sum(jsonb_array_length(i.boxes)) FILTER(WHERE i.deleted_at IS NULL),0)::int box_count,GREATEST(d.updated_at,COALESCE(max(i.updated_at),d.updated_at)) AS content_updated_at FROM omr_datasets d LEFT JOIN omr_songs s ON s.dataset_id=d.id LEFT JOIN omr_images i ON i.song_id=s.id AND s.deleted_at IS NULL WHERE (d.deleted_at IS NOT NULL)=$1 GROUP BY d.id ORDER BY d.created_at DESC,d.id DESC`,
          [req.query.deleted === "deleted"],
        )
      ).rows,
    );
  });
  router.post("/datasets", async (req: any, res: any) => {
    const id = randomUUID();
    res
      .status(201)
      .json(
        (
          await pool.query(
            "INSERT INTO omr_datasets(id,name,description,taxonomy_version) VALUES($1,$2,$3,'layout-v2') RETURNING *",
            [
              id,
              text(req.body.name),
              String(req.body.description || "").slice(0, 2000),
            ],
          )
        ).rows[0],
      );
  });
  router.put("/datasets/:datasetId", async (req: any, res: any) => {
    await datasetRecord(pool, req.params.datasetId);
    const r = await pool.query(
      "UPDATE omr_datasets SET name=$1,description=$2,version=version+1,updated_at=now() WHERE id=$3 AND version=$4 AND deleted_at IS NULL RETURNING *",
      [
        text(req.body.name),
        String(req.body.description || "").slice(0, 2000),
        req.params.datasetId,
        req.body.version,
      ],
    );
    need(r.rowCount, "数据集版本冲突，请重新读取", 409);
    res.json(r.rows[0]);
  });
  router.get("/datasets/:datasetId/songs", async (req: any, res: any) => {
    await datasetRecord(pool, req.params.datasetId);
    res.json(
      (
        await pool.query(
          `SELECT s.*,count(i.id) FILTER(WHERE i.deleted_at IS NULL)::int page_count,count(i.id) FILTER(WHERE i.deleted_at IS NULL AND i.status='confirmed')::int confirmed_count FROM omr_songs s LEFT JOIN omr_images i ON i.song_id=s.id WHERE s.dataset_id=$1 AND s.deleted_at IS NULL GROUP BY s.id ORDER BY s.created_at,s.id`,
          [req.params.datasetId],
        )
      ).rows,
    );
  });
  router.post("/datasets/:datasetId/songs", async (req: any, res: any) =>
    res.status(201).json(
      await transaction(pool, async (c: any) => {
        need(ID.test(req.params.datasetId), "数据集ID无效");
        await datasetRecord(c, req.params.datasetId, { lock: true });
        const name = text(req.body.name),
          group = text(req.body.songGroupKey),
          split = req.body.split;
        need(["train", "val", "test"].includes(split), "split无效");
        need(
          !(
            await c.query(
              "SELECT 1 FROM omr_songs WHERE dataset_id=$1 AND song_group_key=$2 AND split<>$3",
              [req.params.datasetId, group, split],
            )
          ).rowCount,
          "同曲目组必须使用同一split",
          409,
        );
        return (
          await c.query(
            "INSERT INTO omr_songs(id,dataset_id,name,song_group_key,split) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [randomUUID(), req.params.datasetId, name, group, split],
          )
        ).rows[0];
      }),
    ),
  );
  router.put("/songs/:songId", async (req: any, res: any) =>
    res.json(
      await transaction(pool, async (c: any) => {
        let s = await songRecord(c, req.params.songId);
        await datasetRecord(c, s.dataset_id, { lock: true });
        s = await songRecord(c, s.id);
        const name = text(req.body.name),
          group = text(req.body.songGroupKey),
          split = req.body.split;
        need(["train", "val", "test"].includes(split), "split无效");
        need(
          !(
            await c.query(
              "SELECT 1 FROM omr_songs WHERE dataset_id=$1 AND song_group_key=$2 AND split<>$3 AND id<>$4",
              [s.dataset_id, group, split, s.id],
            )
          ).rowCount,
          "同曲目组跨split，请先统一分组",
          409,
        );
        const r = await c.query(
          "UPDATE omr_songs SET name=$1,song_group_key=$2,split=$3,version=version+1 WHERE id=$4 AND version=$5 RETURNING *",
          [name, group, split, s.id, req.body.version],
        );
        need(r.rowCount, "曲目版本冲突", 409);
        return r.rows[0];
      }),
    ),
  );
}
