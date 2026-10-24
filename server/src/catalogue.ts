import { need, ID } from "./annotation.ts";
import { transaction, datasetRecord, songLock } from "./datasets.ts";
import { pageMeta } from "./pages.ts";
export function pageFilter(datasetId: any, q: any = {}) {
  need(ID.test(datasetId), "数据集ID无效");
  need(!q.deleted || ["active", "deleted"].includes(q.deleted), "删除状态无效");
  need(
    !q.status || ["draft", "ai_reviewed", "confirmed", "legacy"].includes(q.status),
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
    if (q.status !== "legacy") where.push("i.annotation_format<>'legacy'");
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
    router.post("/datasets/:datasetId/" + action, (_req: any, res: any) =>
      res
        .status(410)
        .json({ error: "请使用永久删除预览与确认接口；恢复已停用" }),
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
          // Counts cover the current search/split/song scope, independent of
          // the selected status and list pagination. Legacy is exclusive.
          const scope = pageFilter(req.params.datasetId, { ...req.query, status: undefined });
          const reviewCounts = (
            await c.query(
              `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE i.annotation_format<>'legacy' AND i.status='draft')::int AS draft,
                count(*) FILTER (WHERE i.annotation_format<>'legacy' AND i.status='ai_reviewed')::int AS ai_reviewed,
                count(*) FILTER (WHERE i.annotation_format<>'legacy' AND i.status='confirmed')::int AS confirmed,
                count(*) FILTER (WHERE i.annotation_format='legacy')::int AS legacy
               FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE ${scope.where}`,
              scope.params,
            )
          ).rows[0];
          return { items: rows.map(item), total, page, pageSize, reviewCounts };
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
            // The anchor may have left its queue after save/confirm. Resolve it
            // from the dataset, then apply the original filters to candidates.
            const target = (
              await c.query(
                `SELECT i.id,i.created_at::text AS created_at FROM omr_images i
                 JOIN omr_songs s ON s.id=i.song_id
                 WHERE s.dataset_id=$1 AND s.deleted_at IS NULL
                   AND i.deleted_at IS NULL AND i.id=$2`,
                [req.params.datasetId, req.params.pageId],
              )
            ).rows[0];
            need(target, "页面不在当前数据集中，可能已删除或移动", 409);
            const f = pageFilter(req.params.datasetId, {
              ...req.query,
              deleted: "active",
            });
            const n = f.params.length + 1;
            const get = async (op: string, order: string) =>
              (
                await c.query(
                  'SELECT i.id,i.song_id AS "songId" FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE ' +
                    f.where +
                    ` AND (i.created_at,i.id) ${op} ($${n},$${n + 1}::uuid) ORDER BY i.created_at ${order},i.id ${order} LIMIT 1`,
                  [...f.params, target.created_at, target.id],
                )
              ).rows[0] || null;
            // Keep the filtered catalogue order, wrapping once and excluding
            // the anchor. A fixed status survives the anchor's status change.
            const nextPage = (
              await c.query(
                'SELECT i.id,i.song_id AS "songId" FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE ' +
                  f.where +
                  ` AND i.id<>$${n}::uuid
                   ORDER BY CASE WHEN (i.created_at,i.id)<($${n + 1},$${n}::uuid) THEN 0 ELSE 1 END,
                     i.created_at DESC,i.id DESC LIMIT 1`,
                [...f.params, target.id, target.created_at],
              )
            ).rows[0] || null;
            const previousPage = await get(">", "ASC");
            // Compatibility for older clients; the editor uses nextPage.
            const pending = pageFilter(req.params.datasetId, {
              ...req.query,
              deleted: "active",
            });
            const pn = pending.params.length + 1;
            const nextUnconfirmed = (
              await c.query(
                'SELECT i.id,i.song_id AS "songId" FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE ' +
                  pending.where +
                  ` AND i.status<>'confirmed' AND i.id<>$${pn}::uuid
                   ORDER BY CASE WHEN (i.created_at,i.id)<($${pn + 1},$${pn}::uuid) THEN 0 ELSE 1 END,
                     i.created_at DESC,i.id DESC LIMIT 1`,
                [...pending.params, target.id, target.created_at],
              )
            ).rows[0] || null;
            return {
              previousPage,
              nextPage,
              previous: previousPage?.id || null,
              next: (await get("<", "DESC"))?.id || null,
              nextUnconfirmed,
            };
          },
          { isolation: "REPEATABLE READ" },
        ),
      ),
  );
  for (const action of ["delete", "restore"])
    router.post("/datasets/:datasetId/pages/" + action, (_req: any, res: any) =>
      res
        .status(410)
        .json({ error: "请使用永久删除预览与确认接口；恢复已停用" }),
    );
}
