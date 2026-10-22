import { need, ID } from "./annotation.ts";
import { transaction, datasetRecord, songRecord } from "./datasets.ts";
import { pageMeta, PAGE_COLUMNS } from "./pages.ts";
// The digest covers every child version, including individually deleted pages.
// A song row cannot delete newly uploaded or concurrently edited pages unseen by its reviewer.
const revisionSQL =
  "md5(COALESCE(string_agg(i.id::text||':'||i.version::text,',' ORDER BY i.id),''))";
export function registerSongCatalogue(router: any, { pool }: any) {
  router.get("/datasets/:datasetId/song-records", async (req: any, res: any) =>
    res.json(
      await transaction(
        pool,
        async (c: any) => {
          await datasetRecord(c, req.params.datasetId);
          const q = req.query,
            page = Number(q.page ?? 1),
            pageSize = Number(q.pageSize ?? 50);
          need(
            Number.isSafeInteger(page) &&
              page > 0 &&
              page <= 1000000 &&
              [25, 50, 100].includes(pageSize),
            "分页参数无效",
          );
          need(
            !q.deleted || ["active", "deleted"].includes(q.deleted),
            "删除状态无效",
          );
          need(
            !q.status || ["draft", "confirmed", "legacy"].includes(q.status),
            "复核状态无效",
          );
          need(
            !q.split || ["train", "val", "test"].includes(q.split),
            "集合无效",
          );
          need(!q.songId || ID.test(q.songId), "曲目ID无效");
          need(
            typeof (q.search ?? "") === "string" &&
              (q.search || "").length <= 200,
            "搜索过长",
          );
          const params = [req.params.datasetId, q.deleted === "deleted"];
          let where = "s.dataset_id=$1 AND (s.deleted_at IS NOT NULL)=$2";
          if (q.split) {
            params.push(q.split);
            where += " AND s.split=$" + params.length;
          }
          if (q.songId) {
            params.push(q.songId);
            where += " AND s.id=$" + params.length;
          }
          if (q.search) {
            params.push(q.search);
            where += ` AND (position(lower($${params.length}) in lower(s.name))>0 OR position(lower($${params.length}) in lower(s.song_group_key))>0 OR EXISTS(SELECT 1 FROM omr_images x WHERE x.song_id=s.id AND x.deleted_at IS NULL AND (position(lower($${params.length}) in lower(x.original_name))>0 OR position(lower($${params.length}) in lower(x.source))>0)))`;
          }
          const aggregate = `SELECT s.*,count(i.id) FILTER(WHERE i.deleted_at IS NULL)::int page_count,count(i.id) FILTER(WHERE i.deleted_at IS NULL AND i.status='confirmed')::int confirmed_count,count(i.id) FILTER(WHERE i.deleted_at IS NULL AND i.annotation_format='legacy')::int legacy_count,COALESCE(sum(jsonb_array_length(i.boxes)) FILTER(WHERE i.deleted_at IS NULL),0)::int box_count,${revisionSQL} page_revision,GREATEST(s.created_at,COALESCE(max(i.updated_at),s.created_at)) updated_at,(array_agg(i.id ORDER BY i.page_order,i.id) FILTER(WHERE i.deleted_at IS NULL))[1] first_page_id FROM omr_songs s LEFT JOIN omr_images i ON i.song_id=s.id WHERE ${where} GROUP BY s.id`;
          let having = "";
          if (q.status === "confirmed")
            having = " WHERE page_count>0 AND confirmed_count=page_count";
          if (q.status === "draft")
            having = " WHERE page_count=0 OR confirmed_count<page_count";
          if (q.status === "legacy") having = " WHERE legacy_count>0";
          const sql =
              "WITH songs AS (" + aggregate + ") SELECT * FROM songs" + having,
            total = Number(
              (await c.query("SELECT count(*) n FROM (" + sql + ") q", params))
                .rows[0].n,
            );
          const items = (
            await c.query(
              sql +
                ` ORDER BY created_at DESC,id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
              [...params, pageSize, (page - 1) * pageSize],
            )
          ).rows;
          return { items, total, page, pageSize };
        },
        { isolation: "REPEATABLE READ" },
      ),
    ),
  );
  for (const action of ["delete", "restore"])
    router.post(
      "/datasets/:datasetId/songs/" + action,
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
                new Set(items.map((i: any) => i?.id)).size === items.length,
              "请选择1–100首不同歌曲",
            );
            for (const i of items)
              need(
                ID.test(i.id) &&
                  Number.isSafeInteger(i.version) &&
                  /^[a-f0-9]{32}$/.test(i.pageRevision || ""),
                "歌曲标识或版本无效",
              );
            const rows = (
              await c.query(
                `SELECT s.*,${revisionSQL} page_revision FROM omr_songs s LEFT JOIN omr_images i ON i.song_id=s.id WHERE s.dataset_id=$1 AND s.id=ANY($2::uuid[]) GROUP BY s.id ORDER BY s.id`,
                [d.id, items.map((i: any) => i.id)],
              )
            ).rows;
            need(rows.length === items.length, "歌曲不属于此数据集", 409);
            for (const s of rows) {
              const expected = items.find((i: any) => i.id === s.id);
              need(
                s.version === expected.version &&
                  s.page_revision === expected.pageRevision,
                "歌曲或谱页版本已变化，请刷新；未修改任何记录",
                409,
              );
              need(
                action === "delete" ? !s.deleted_at : !!s.deleted_at,
                "歌曲状态已变化",
                409,
              );
            }
            await c.query(
              `UPDATE omr_songs SET deleted_at=${action === "delete" ? "now()" : "NULL"},version=version+1 WHERE id=ANY($1::uuid[])`,
              [items.map((i: any) => i.id)],
            );
            await c.query(
              "UPDATE omr_images SET version=version+1,updated_at=now() WHERE song_id=ANY($1::uuid[])",
              [items.map((i: any) => i.id)],
            );
            await c.query(
              "UPDATE omr_datasets SET updated_at=now() WHERE id=$1",
              [d.id],
            );
            return { count: rows.length };
          }),
        ),
    );
  router.post("/songs/:songId/pages/reorder", async (req: any, res: any) =>
    res.json(
      await transaction(pool, async (c: any) => {
        let s = await songRecord(c, req.params.songId);
        await datasetRecord(c, s.dataset_id, { lock: true });
        s = await songRecord(c, s.id);
        const items = req.body.items;
        need(
          Array.isArray(items) &&
            items.length > 0 &&
            items.length <= 10000 &&
            new Set(items.map((i: any) => i?.id)).size === items.length,
          "页序列表必须完整且不重复",
        );
        for (const i of items)
          need(
            ID.test(i.id) && Number.isSafeInteger(i.version) && i.version > 0,
            "页标识或版本无效",
          );
        const rows = (
          await c.query(
            "SELECT " +
              PAGE_COLUMNS +
              " FROM omr_images WHERE song_id=$1 AND deleted_at IS NULL ORDER BY page_order,id FOR UPDATE",
            [s.id],
          )
        ).rows;
        need(
          rows.length === items.length &&
            rows.every((p: any) =>
              items.some((i: any) => i.id === p.id && i.version === p.version),
            ),
          "谱页已变化，请刷新；未修改页序",
          409,
        );
        // Reserve orders of individually deleted pages so restoration never creates duplicates.
        const reserved = new Set(
          (
            await c.query(
              "SELECT page_order FROM omr_images WHERE song_id=$1 AND deleted_at IS NOT NULL",
              [s.id],
            )
          ).rows.map((p: any) => p.page_order),
        );
        let order = 0;
        for (const i of items) {
          do {
            order++;
          } while (reserved.has(order));
          need(order <= 100000, "页序超出限制");
          await c.query(
            "UPDATE omr_images SET page_order=$1,version=version+1,updated_at=now() WHERE id=$2",
            [order, i.id],
          );
        }
        const updated = (
          await c.query(
            "SELECT " +
              PAGE_COLUMNS +
              " FROM omr_images WHERE song_id=$1 AND deleted_at IS NULL ORDER BY page_order,id",
            [s.id],
          )
        ).rows;
        return updated.map(pageMeta);
      }),
    ),
  );
}
