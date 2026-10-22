import { need, ID } from "./annotation.ts";
import { transaction, datasetRecord, songLock } from "./datasets.ts";
import { pageMeta } from "./pages.ts";
export function pageFilter(datasetId: any, q: any = {}) {
  need(ID.test(datasetId), "数据集ID无效");
  need(!q.deleted || ["active", "deleted"].includes(q.deleted), "删除状态无效");
  need(
    !q.status || ["draft", "confirmed", "legacy"].includes(q.status),
    "复核状态无效",
  );
  need(!q.split || ["train", "val", "test"].includes(q.split), "split无效");
  need(!q.songId || ID.test(q.songId), "曲目ID无效");
  need(
    typeof (q.search ?? "") === "string" && (q.search || "").length <= 200,
    "搜索过长",
  );
  const params = [datasetId, q.deleted === "deleted"],
    where = [
      "s.dataset_id=$1",
      "s.deleted_at IS NULL",
      "(i.deleted_at IS NOT NULL)=$2",
    ];
  for (const [key, column] of [
    ["split", "s.split"],
    ["songId", "s.id"],
  ])
    if (q[key]) {
      params.push(q[key]);
      where.push(column + "=$" + params.length);
    }
  if (q.status) {
    params.push(q.status);
    where.push(
      q.status === "legacy"
        ? `i.annotation_format=$${params.length}`
        : `i.status=$${params.length}`,
    );
  }
  if (q.search) {
    params.push(q.search);
    const n = params.length;
    where.push(
      `(position(lower($${n}) in lower(i.original_name))>0 OR position(lower($${n}) in lower(s.name))>0 OR position(lower($${n}) in lower(i.source))>0)`,
    );
  }
  return { params, where: where.join(" AND ") };
}
const item = (r: any) => ({
  ...pageMeta(r),
  songName: r.song_name,
  split: r.split,
  songGroupKey: r.song_group_key,
  boxCount: r.box_count,
});
export function registerCatalogue(router: any, { pool }: any) {
  for (const action of ["delete", "restore"])
    router.post("/datasets/:datasetId/" + action, async (req: any, res: any) =>
      res.json(
        await transaction(pool, async (c: any) => {
          const d = await datasetRecord(c, req.params.datasetId, {
            deleted: true,
            lock: true,
          });
          need(d.version === req.body.version, "数据集版本冲突", 409);
          need(
            action === "delete" ? !d.deleted_at : !!d.deleted_at,
            "数据集状态已变化",
            409,
          );
          const impact = (
            await c.query(
              "SELECT count(*)::int images,COALESCE(sum(jsonb_array_length(i.boxes)),0)::int boxes FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.deleted_at IS NULL",
              [d.id],
            )
          ).rows[0];
          if (action === "delete" && req.body.expectedImages !== undefined)
            need(
              req.body.expectedImages === impact.images &&
                req.body.expectedBoxes === impact.boxes,
              "影响范围已变化，请刷新后重新确认",
              409,
            );
          const r = (
            await c.query(
              `UPDATE omr_datasets SET deleted_at=${action === "delete" ? "now()" : "NULL"},version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
              [d.id],
            )
          ).rows[0];
          await c.query(
            "UPDATE omr_images SET version=version+1,updated_at=now() WHERE song_id IN (SELECT id FROM omr_songs WHERE dataset_id=$1)",
            [d.id],
          );
          return { dataset: r, impact };
        }),
      ),
    );
  router.get("/datasets/:datasetId/pages", async (req: any, res: any) =>
    res.json(
      await transaction(
        pool,
        async (c: any) => {
          await datasetRecord(c, req.params.datasetId);
          const page = Number(req.query.page ?? 1),
            pageSize = Number(req.query.pageSize ?? 50);
          need(
            Number.isSafeInteger(page) &&
              page >= 1 &&
              page <= 1000000 &&
              [25, 50, 100].includes(pageSize),
            "分页参数无效",
          );
          const f = pageFilter(req.params.datasetId, req.query);
          const total = Number(
              (
                await c.query(
                  "SELECT count(*) n FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE " +
                    f.where,
                  f.params,
                )
              ).rows[0].n,
            ),
            rows = (
              await c.query(
                "SELECT i.id,i.original_name,i.mime,i.width,i.height,i.checksum,i.version,i.song_id,i.page_order,i.annotation_format,i.annotation_version,i.status,i.page_type,i.coordinate,i.deleted_at,i.source,i.updated_at,jsonb_array_length(i.boxes)::int box_count,s.dataset_id,s.name song_name,s.split,s.song_group_key FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE " +
                  f.where +
                  " ORDER BY i.created_at DESC,i.id DESC LIMIT $" +
                  (f.params.length + 1) +
                  " OFFSET $" +
                  (f.params.length + 2),
                [...f.params, pageSize, (page - 1) * pageSize],
              )
            ).rows;
          return { items: rows.map(item), total, page, pageSize };
        },
        { isolation: "REPEATABLE READ" },
      ),
    ),
  );
  router.get(
    "/datasets/:datasetId/pages/:pageId/neighbors",
    async (req: any, res: any) =>
      res.json(
        await transaction(
          pool,
          async (c: any) => {
            await datasetRecord(c, req.params.datasetId);
            need(ID.test(req.params.pageId), "页面ID无效");
            const f = pageFilter(req.params.datasetId, req.query),
              n = f.params.length + 1,
              target = (
                await c.query(
                  "SELECT i.id,i.created_at::text AS created_at FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE " +
                    f.where +
                    " AND i.id=$" +
                    n,
                  [...f.params, req.params.pageId],
                )
              ).rows[0];
            need(target, "页面不在当前筛选中，可能已删除或移动", 409);
            const get = async (op: any, order: any) =>
              (
                await c.query(
                  "SELECT i.id FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE " +
                    f.where +
                    ` AND (i.created_at,i.id) ${op} ($${n},$${n + 1}) ORDER BY i.created_at ${order},i.id ${order} LIMIT 1`,
                  [...f.params, target.created_at, target.id],
                )
              ).rows[0]?.id || null;
            return {
              previous: await get(">", "ASC"),
              next: await get("<", "DESC"),
            };
          },
          { isolation: "REPEATABLE READ" },
        ),
      ),
  );
  for (const action of ["delete", "restore"])
    router.post(
      "/datasets/:datasetId/pages/" + action,
      async (req: any, res: any) =>
        res.json(
          await transaction(pool, async (c: any) => {
            const d = await datasetRecord(c, req.params.datasetId, {
                lock: true,
              }),
              items = req.body.items;
            need(
              Array.isArray(items) &&
                items.length > 0 &&
                items.length <= 100 &&
                new Set(items.map((i: any) => i.id)).size === items.length,
              "请选择1–100条不重复记录",
            );
            for (const i of items)
              need(
                ID.test(i.id) &&
                  Number.isSafeInteger(i.version) &&
                  i.version > 0,
                "图片标识或版本无效",
              );
            const rows = (
              await c.query(
                "SELECT i.* FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.id=ANY($2::uuid[]) ORDER BY i.id FOR UPDATE OF i",
                [d.id, items.map((i: any) => i.id)],
              )
            ).rows;
            need(
              rows.length === items.length,
              "图片不属于此数据集或不存在",
              409,
            );
            for (const r of rows) {
              need(
                r.version === items.find((i: any) => i.id === r.id).version,
                "图片版本冲突，未删除/恢复任何记录",
                409,
              );
              need(
                action === "delete" ? !r.deleted_at : !!r.deleted_at,
                "图片状态已变化",
                409,
              );
            }
            const changed = (
              await c.query(
                `UPDATE omr_images SET deleted_at=${action === "delete" ? "now()" : "NULL"},version=version+1,updated_at=now() WHERE id=ANY($1::uuid[]) RETURNING id,version,deleted_at`,
                [items.map((i: any) => i.id)],
              )
            ).rows;
            await c.query(
              "UPDATE omr_datasets SET updated_at=now() WHERE id=$1",
              [d.id],
            );
            return { items: changed };
          }),
        ),
    );
}
