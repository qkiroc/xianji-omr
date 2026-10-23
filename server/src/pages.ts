import { mergeRegionReviews } from "./crop-rules.ts";
import sharp from "sharp";
import express from "express";
import { randomUUID } from "node:crypto";
import {
  need,
  ID,
  TAXONOMY,
  LATEST_TAXONOMY,
  regions,
  digest,
} from "./annotation.ts";
import { coordinateImage, transformBox } from "./images.ts";
import {
  transaction,
  songRecord,
  songLock,
  datasetRecord,
  LEGACY_SONG,
} from "./datasets.ts";
export const PAGE_COLUMNS =
  "id,original_name,mime,width,height,checksum,version,song_id,page_order,annotation_format,annotation_version,status,page_type,coordinate,deleted_at,source,updated_at";
export const pageMeta = (r: any) => ({
  id: r.id,
  name: r.original_name,
  mime: r.coordinate?.working.mime || r.mime,
  width: r.coordinate?.working.width || r.width,
  height: r.coordinate?.working.height || r.height,
  originalWidth: r.width,
  originalHeight: r.height,
  checksum: r.checksum,
  coordinate: r.coordinate
    ? {
        ...r.coordinate,
        original: { ...r.coordinate.original, key: undefined },
        working: { ...r.coordinate.working, key: undefined },
      }
    : null,
  version: r.version,
  songId: r.song_id,
  datasetId: r.dataset_id,
  deletedAt: r.deleted_at,
  source: r.source || "",
  pageOrder: r.page_order,
  annotationFormat:
    r.annotation_format === "legacy"
      ? "legacy"
      : r.annotation_version || TAXONOMY,
  status: r.status,
  pageType: r.page_type,
  updatedAt: r.updated_at,
});
export const pageValue = (r: any) => ({
  image: pageMeta(r),
  deletedBoxes: r.deleted_boxes || [],
  boxes: r.boxes.map((b: any, i: any) => ({
    ...b,
    classKey: b.classKey ?? null,
    parentSystemId: b.parentSystemId ?? null,
    readingOrder: b.readingOrder ?? i,
  })),
});
export async function pageRecord(c: any, id: any, lock: any = false) {
  need(ID.test(id), "页面ID无效");
  const sql =
    "SELECT i.*,s.dataset_id,s.deleted_at AS song_deleted,d.deleted_at AS dataset_deleted FROM omr_images i JOIN omr_songs s ON s.id=i.song_id JOIN omr_datasets d ON d.id=s.dataset_id WHERE i.id=$1";
  let r = (await c.query(sql, [id])).rows[0];
  need(r, "页面不存在", 404);
  if (lock) {
    await songLock(c, r.dataset_id);
    r = (await c.query(sql + " FOR UPDATE OF i", [id])).rows[0];
  }
  need(!r.dataset_deleted, "数据集已删除，请先恢复", 410);
  need(!r.song_deleted, "歌曲已删除，请先恢复", 410);
  need(!r.deleted_at, "图片已删除，请从已删除视图恢复", 410);
  return r;
}
export function registerPages(router: any, { pool, storage, config }: any) {
  let busy = false,
    thumbnailQueue = Promise.resolve(),
    thumbnailPending = 0;
  const thumbnailCache = new Map();
  router.post(
    "/songs/:songId/pages",
    (req: any, res: any, next: any) => {
      if (busy)
        return res.status(429).json({ error: "已有图片正在处理，请稍后重试" });
      busy = true;
      res.once("finish", () => (busy = false));
      res.once("close", () => (busy = false));
      next();
    },
    express.raw({ type: () => true, limit: "20mb" }),
    async (req: any, res: any) => {
      const keys: any[] = [];
      try {
        const mime = String(req.headers["content-type"]).split(";")[0],
          id = randomUUID(),
          key = config.oss.prefix + id;
        let name: string = "";
        try {
          name = decodeURIComponent(req.headers["x-file-name"] || "image");
        } catch {
          need(false, "文件名无效");
        }
        need(name.length <= 255 && !/[\x00-\x1f]/.test(name), "文件名无效");
        const { work, coordinate } = await coordinateImage(req.body, mime, key);
        const r = await transaction(pool, async (c: any) => {
          const s = await songRecord(c, req.params.songId);
          need(s.id !== LEGACY_SONG, "请先创建明确曲目后上传");
          await datasetRecord(c, s.dataset_id, { lock: true });
          await songRecord(c, s.id);
          const order = Number(
            (
              await c.query(
                "SELECT COALESCE(max(page_order),0)+1 AS n FROM omr_images WHERE song_id=$1",
                [s.id],
              )
            ).rows[0].n,
          );
          await storage.put(key, req.body, mime);
          keys.push(key);
          if (coordinate.working.key !== key) {
            await storage.put(
              coordinate.working.key,
              work,
              coordinate.working.mime,
            );
            keys.push(coordinate.working.key);
          }
          return (
            await c.query(
              `INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,song_id,page_order,coordinate,annotation_format) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'layout-v1') RETURNING omr_images.*,(SELECT dataset_id FROM omr_songs WHERE id=omr_images.song_id) AS dataset_id`,
              [
                id,
                key,
                name,
                mime,
                coordinate.original.width,
                coordinate.original.height,
                digest(req.body),
                s.id,
                order,
                coordinate,
              ],
            )
          ).rows[0];
        });
        res.status(201).json(pageValue(r));
      } catch (e: any) {
        for (const key of keys)
          await storage
            .delete(key)
            .catch(() => console.error("UPLOAD_COMPENSATION_FAILED"));
        throw e;
      }
    },
  );
  router.use(express.json({ limit: "2mb" }));
  router.get("/songs/:songId/pages", async (req: any, res: any) => {
    need(
      !req.query.deleted || ["active", "deleted"].includes(req.query.deleted),
      "删除状态无效",
    );
    await songRecord(pool, req.params.songId);
    res.json(
      (
        await pool.query(
          "SELECT " +
            PAGE_COLUMNS +
            " FROM omr_images WHERE song_id=$1 AND (deleted_at IS NOT NULL)=$2 ORDER BY page_order,id",
          [req.params.songId, req.query.deleted === "deleted"],
        )
      ).rows.map(pageMeta),
    );
  });
  router.get("/pages/:pageId", async (req: any, res: any) =>
    res.json(pageValue(await pageRecord(pool, req.params.pageId))),
  );
  router.get("/pages/:pageId/content", async (req: any, res: any) => {
    const p = await pageRecord(pool, req.params.pageId),
      asset =
        req.query.original === "1"
          ? { key: p.object_key, mime: p.mime }
          : p.coordinate?.working;
    need(asset, "历史页面需先建立坐标工作图", 409);
    if (req.query.thumbnail === "1") {
      need(req.query.original !== "1", "缩略图与原图参数不能同时使用");
      const key = p.id + ":" + p.version;
      let thumb = thumbnailCache.get(key);
      if (!thumb) {
        need(thumbnailPending < 16, "缩略图正忙，请稍后重试", 429);
        thumbnailPending++;
        const task = thumbnailQueue
          .catch(() => {})
          .then(async () => {
            if (thumbnailCache.has(key)) return thumbnailCache.get(key);
            let generated = await sharp(await storage.get(asset.key), {
              limitInputPixels: 50000000,
            })
              .resize(90, 120, { fit: "inside", withoutEnlargement: true })
              .png()
              .toBuffer();
            if (thumbnailCache.size >= 128)
              thumbnailCache.delete(thumbnailCache.keys().next().value);
            thumbnailCache.set(key, generated);
            return generated;
          });
        thumbnailQueue = task;
        try {
          thumb = await task;
        } finally {
          thumbnailPending--;
        }
      }
      return res
        .type("image/png")
        .set({
          "X-Checksum-Sha256": digest(thumb),
          "Content-Length": String(thumb.length),
        })
        .send(thumb);
    }
    const data = await storage.get(asset.key);
    res
      .type(asset.mime)
      .set({
        "X-Checksum-Sha256":
          req.query.original === "1"
            ? p.checksum
            : p.coordinate.working.checksum,
        "Content-Length": String(data.length),
      })
      .send(data);
  });
  router.post("/pages/:pageId/normalize", async (req: any, res: any) =>
    res.json(
      await transaction(pool, async (c: any) => {
        const p = await pageRecord(c, req.params.pageId, true);
        need(p.version === req.body.version, "版本冲突，原草稿保留", 409);
        if (p.coordinate) return pageValue(p);
        const data = await storage.get(p.object_key);
        need(digest(data) === p.checksum, "原图校验值不匹配", 409);
        const { work, coordinate } = await coordinateImage(
          data,
          p.mime,
          p.object_key,
        );
        if (coordinate.working.key !== p.object_key)
          await storage.put(
            coordinate.working.key,
            work,
            coordinate.working.mime,
          );
        const boxes = p.boxes.map((b: any) =>
          transformBox(b, p.width, p.height, coordinate.orientation),
        );
        return pageValue(
          (
            await c.query(
              "UPDATE omr_images SET coordinate=$1,legacy_boxes=$2,boxes=$3,status='draft',version=version+1 WHERE id=$4 RETURNING omr_images.*,(SELECT dataset_id FROM omr_songs WHERE id=omr_images.song_id) AS dataset_id",
              [
                coordinate,
                JSON.stringify(p.boxes),
                JSON.stringify(boxes),
                p.id,
              ],
            )
          ).rows[0],
        );
      }),
    ),
  );
  router.put("/pages/:pageId", async (req: any, res: any) =>
    res.json(
      await transaction(pool, async (c: any) => {
        const p = await pageRecord(c, req.params.pageId, true),
          body = req.body;
        need(
          body.version === p.version,
          "页面版本冲突：请保留/导出草稿后重新读取",
          409,
        );
        need(
          [TAXONOMY, LATEST_TAXONOMY].includes(body.annotationFormat),
          "请使用类别标注格式",
          409,
        );
        need(
          p.annotation_version !== LATEST_TAXONOMY ||
            body.annotationFormat === LATEST_TAXONOMY,
          "旧客户端不能覆盖新版元信息，请刷新升级",
          409,
        );
        need(p.coordinate, "请先建立坐标工作图", 409);
        const song = await songRecord(c, body.songId || p.song_id);
        need(song.dataset_id === p.dataset_id, "不能将图片写入另一数据集", 409);
        await datasetRecord(c, song.dataset_id, { lock: true });
        const pageOrder = body.pageOrder ?? p.page_order,
          pageType = body.pageType ?? p.page_type;
        need(
          Number.isInteger(pageOrder) && pageOrder > 0 && pageOrder <= 100000,
          "页序必须是1–100000的整数",
        );
        need(
          !(
            await c.query(
              "SELECT 1 FROM omr_images WHERE song_id=$1 AND page_order=$2 AND id<>$3",
              [song.id, pageOrder, p.id],
            )
          ).rowCount,
          "该曲目已有此页序，请选择空闲页序",
          409,
        );
        need(
          body.source === undefined ||
            (typeof body.source === "string" && body.source.length <= 500),
          "来源过长",
        );
        const boxes = mergeRegionReviews(
          p.boxes,
          regions(
            body.boxes,
            p.coordinate.working.width,
            p.coordinate.working.height,
            { pageType, taxonomyVersion: body.annotationFormat },
          ),
          p.status,
        );
        need(
          p.boxes.every((b: any) => boxes.some((x: any) => x.id === b.id)),
          "删除已保存区域请使用永久删除预览与确认接口",
          409,
        );
        const deletedBoxes: any[] = [];
        const r = (
          await c.query(
            "UPDATE omr_images SET boxes=$1,song_id=$2,page_order=$3,page_type=$4,annotation_format='layout-v1',status='draft',version=version+1,updated_at=now(),annotation_version=$6,source=$7,deleted_boxes=$8 WHERE id=$5 RETURNING omr_images.*,(SELECT dataset_id FROM omr_songs WHERE id=omr_images.song_id) AS dataset_id",
            [
              JSON.stringify(boxes),
              song.id,
              pageOrder,
              pageType,
              p.id,
              body.annotationFormat,
              body.source ?? p.source,
              JSON.stringify(deletedBoxes),
            ],
          )
        ).rows[0];
        return pageValue(r);
      }),
    ),
  );
  router.post("/pages/:pageId/confirm", async (req: any, res: any) =>
    res.json(
      await transaction(pool, async (c: any) => {
        const p = await pageRecord(c, req.params.pageId, true);
        need(req.body.version === p.version, "页面版本冲突", 409);
        need(
          p.annotation_format === TAXONOMY && p.coordinate,
          "历史框请先补充类别并保存",
          409,
        );
        const s = await songRecord(c, p.song_id);
        await songLock(c, s.dataset_id);
        need(
          s.id !== LEGACY_SONG && s.song_group_key !== "legacy-unassigned",
          "请先整理明确曲目分组",
          409,
        );
        need(
          !(
            await c.query(
              "SELECT 1 FROM omr_images WHERE song_id=$1 AND page_order=$2 AND id<>$3",
              [s.id, p.page_order, p.id],
            )
          ).rowCount,
          "页序重复，请先整理",
          409,
        );
        need(
          req.body.acknowledged === true,
          "确认表示已检查全部目标区域；负样本表示确无目标",
        );
        regions(
          p.boxes,
          p.coordinate.working.width,
          p.coordinate.working.height,
          {
            confirm: true,
            pageType: p.page_type,
            taxonomyVersion: p.annotation_version || TAXONOMY,
          },
        );
        const reviewType = req.body.reviewType ?? "human";
        need(["human", "ai"].includes(reviewType), "复核类型无效");
        return pageValue((await c.query(
          "UPDATE omr_images SET status=$2,boxes=(SELECT COALESCE(jsonb_agg(CASE WHEN $2='confirmed' THEN b||jsonb_build_object('reviewStatus','confirmed') ELSE b||jsonb_build_object('reviewStatus','draft') END),'[]'::jsonb) FROM jsonb_array_elements(boxes) b),version=version+1,updated_at=now() WHERE id=$1 RETURNING omr_images.*,(SELECT dataset_id FROM omr_songs WHERE id=omr_images.song_id) AS dataset_id",
          [p.id, reviewType === "ai" ? "ai_reviewed" : "confirmed"],
        )).rows[0]);
      }),
    ),
  );
  router.post("/pages/:pageId/unconfirm", async (req: any, res: any) =>
    res.json(
      await transaction(pool, async (c: any) => {
        const p = await pageRecord(c, req.params.pageId, true);
        need(p.version === req.body.version, "页面版本冲突", 409);
        return pageValue(
          (
            await c.query(
              "UPDATE omr_images SET status='draft',version=version+1,updated_at=now() WHERE id=$1 RETURNING omr_images.*,(SELECT dataset_id FROM omr_songs WHERE id=omr_images.song_id) AS dataset_id",
              [p.id],
            )
          ).rows[0],
        );
      }),
    ),
  );
}
