import { TIME_DENOMINATORS, timeSignatureComplete } from "../../shared/time-signatures.ts";
import { ANNOTATION_TREND_DAYS, annotationWindow, annotationTrend } from "../../shared/annotation-trend.ts";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { need, ID, digest } from "./annotation.ts";
import { transaction, datasetRecord, text } from "./datasets.ts";
import { cropRectangle } from "./crop-rules.ts";
import { KEY_TONICS, keyLabelComplete } from "../../shared/key-signatures.ts";

const datasetSql = `SELECT d.*,s.name source_name,
  count(r.id)::int sample_count,count(r.id) FILTER(WHERE r.status='confirmed')::int confirmed_count
  FROM omr_key_datasets d LEFT JOIN omr_datasets s ON s.id=d.source_dataset_id
  LEFT JOIN omr_key_records r ON r.dataset_id=d.id`;
const publicRecord = ({ source_checksum, ...record }: any) => record;
async function keyDataset(c: any, id: string) {
  need(ID.test(id), "标注数据集 ID 无效");
  const d = (await c.query(datasetSql + " WHERE d.id=$1 GROUP BY d.id,s.name", [id])).rows[0];
  need(d, "标注数据集不存在", 404);
  return d;
}

// Freeze crop geometry and provenance, so layout edits never silently change a labeled image.
async function importCrops(c: any, datasetId: string, sourceId: string) {
  await datasetRecord(c, sourceId, { lock: true });
  const sources = (await c.query(`SELECT i.id,i.checksum,i.coordinate,i.width,i.height,i.page_order,i.original_name,
    s.id song_id,s.name song_name,s.song_group_key,s.split,b.box
    FROM omr_images i JOIN omr_songs s ON s.id=i.song_id
    CROSS JOIN LATERAL jsonb_array_elements(i.boxes) b(box)
    WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.deleted_at IS NULL
    AND i.annotation_format<>'legacy' AND b.box->>'classKey'='key_signature'
    ORDER BY s.created_at,s.id,i.page_order,i.id,(b.box->>'y')::int,(b.box->>'x')::int,b.box->>'id'`, [sourceId])).rows;
  let inserted = 0;
  for (let offset = 0; offset < sources.length; offset += 500) {
    const records = sources.slice(offset, offset + 500).map((p: any) => ({
      id: randomUUID(), source_page_id: p.id, source_box_id: p.box.id,
      source_checksum: p.coordinate?.working?.checksum || p.checksum,
      rectangle: cropRectangle(p.box, p.coordinate?.working?.width || p.width, p.coordinate?.working?.height || p.height),
      source: { songId: p.song_id, songName: p.song_name, pageOrder: p.page_order,
        pageName: p.original_name, metadata: p.box.metadata },
      song_group_key: p.song_group_key, split: p.split,
    }));
    const result = await c.query(`INSERT INTO omr_key_records
      (id,dataset_id,source_page_id,source_box_id,source_checksum,rectangle,source,song_group_key,split)
      SELECT x.id,$1,x.source_page_id,x.source_box_id,x.source_checksum,x.rectangle,x.source,x.song_group_key,x.split
      FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,source_page_id uuid,source_box_id text,
        source_checksum text,rectangle jsonb,source jsonb,song_group_key text,split text)
      ON CONFLICT(dataset_id,source_page_id,source_box_id) DO NOTHING RETURNING id`, [datasetId, JSON.stringify(records)]);
    inserted += result.rowCount;
  }
  await c.query("UPDATE omr_key_datasets SET updated_at=now() WHERE id=$1", [datasetId]);
  return inserted;
}

export function registerKeySignatures(router: any, dependencies: any) {
  return registerCropLabels(router, dependencies, false);
}
export function registerTimeSignatures(router: any, dependencies: any) {
  return registerCropLabels(router, dependencies, true);
}
function registerCropLabels(originalRouter: any, { pool: originalPool, storage }: any, timeSignature: boolean) {
  const resource = timeSignature ? "time-signatures" : "key-signatures";
  const firstField = timeSignature ? "numerator" : "tonic", secondField = timeSignature ? "denominator" : "kind";
  // Both tasks share provenance, queues and save semantics. Map the two label columns
  // at the SQL boundary; public responses retain their task-specific database fields.
  const mapSql = (sql: string) => timeSignature ? sql
    .replace(/\bomr_key_/g, "omr_time_").replace(/'key_signature'/g, "'time_signature'")
    .replace(/\btonic=\$3/g, "tonic::text=$3").replace(/\bkind=\$4/g, "kind::text=$4")
    .replace(/\btonic\b/g, "numerator").replace(/\bkind\b/g, "denominator") : sql;
  const database = (connection: any): any => ({
    query: (sql: string, parameters?: unknown[]) => connection.query(mapSql(sql), parameters),
    connect: async () => database(await connection.connect()), release: () => connection.release(),
  });
  const pool = database(originalPool);
  const router = Object.fromEntries(["get", "post", "put"].map((method) => [method,
    (path: string, handler: any) => originalRouter[method](path.replace("key-signatures", resource), handler)]));
  router.get("/key-signatures/datasets", async (_req: any, res: any) => {
    res.json((await pool.query(datasetSql + " GROUP BY d.id,s.name ORDER BY d.created_at DESC,d.id DESC")).rows);
  });
  router.post("/key-signatures/datasets", async (req: any, res: any) => {
    need(ID.test(req.body.sourceDatasetId), "请选择关联切图数据集");
    res.status(201).json(await transaction(pool, async (c: any) => {
      const id = randomUUID();
      await datasetRecord(c, req.body.sourceDatasetId, { lock: true });
      await c.query("INSERT INTO omr_key_datasets(id,name,description,source_dataset_id) VALUES($1,$2,$3,$4)",
        [id, text(req.body.name), String(req.body.description || "").slice(0, 2000), req.body.sourceDatasetId]);
      const imported = await importCrops(c, id, req.body.sourceDatasetId);
      return { ...(await keyDataset(c, id)), imported };
    }));
  });
  router.post("/key-signatures/datasets/:datasetId/sync", async (req: any, res: any) => {
    res.json(await transaction(pool, async (c: any) => {
      const d = await keyDataset(c, req.params.datasetId);
      need(d.source_dataset_id, "关联切图数据集已删除，无法导入新切图", 410);
      const imported = await importCrops(c, d.id, d.source_dataset_id);
      return { ...(await keyDataset(c, d.id)), imported };
    }));
  });
  router.get("/key-signatures/datasets/:datasetId/records", async (req: any, res: any) => {
    const trendDays = Number(req.query.trendDays || 30);
    need((ANNOTATION_TREND_DAYS as readonly number[]).includes(trendDays), "统计范围无效");
    const page = Number(req.query.page || 1), pageSize = Number(req.query.pageSize || 50);
    need(Number.isSafeInteger(page) && page > 0 && page <= 1000000 && [10,25,50,100].includes(pageSize), "分页参数无效");
    const status = req.query.status || "", tonic = req.query[firstField] || "", kind = req.query[secondField] || "", split = req.query.split || "", search = req.query.search || "";
    need(["","draft","confirmed"].includes(status) && (!tonic || (timeSignature ? /^(?:[1-9]|[12][0-9]|3[0-2])$/.test(tonic) : KEY_TONICS.includes(tonic))) &&
      (timeSignature ? ["",...TIME_DENOMINATORS.map(String)].includes(kind) : ["","original","play"].includes(kind)) && ["","train","val","test"].includes(split) &&
      typeof search === "string" && search.length <= 200, "列表筛选参数无效");
    res.json(await transaction(pool, async (c: any) => {
      const dataset = await keyDataset(c, req.params.datasetId);
      const parameters = [dataset.id, status, tonic, kind, split, search];
      const where = `dataset_id=$1 AND ($2='' OR status=$2) AND ($3='' OR tonic=$3)
        AND ($4='' OR kind=$4) AND ($5='' OR split=$5)
        AND ($6='' OR source->>'songName' ILIKE '%'||$6||'%' OR source->>'pageName' ILIKE '%'||$6||'%')`;
      const total = Number((await c.query("SELECT count(*) AS total FROM omr_key_records WHERE " + where, parameters)).rows[0].total);
      const actualPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const rows = (await c.query("SELECT * FROM omr_key_records WHERE " + where + " ORDER BY sequence,id LIMIT $7 OFFSET $8",
        [...parameters,pageSize,(actualPage-1)*pageSize])).rows;
      const window = annotationWindow(trendDays);
      const daily = (await c.query(`SELECT to_char(first_labeled_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,
        count(*)::int AS count,count(*) FILTER(WHERE label_time_estimated)::int AS estimated FROM omr_key_records
        WHERE dataset_id=$1 AND first_labeled_at>=($2::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND first_labeled_at<(($3::date+interval '1 day') AT TIME ZONE 'Asia/Shanghai') GROUP BY 1 ORDER BY 1`,
        [dataset.id,window.start,window.end])).rows;
      return { dataset, items: rows.map(publicRecord), total, page: actualPage, pageSize, annotationTrend: annotationTrend(trendDays,daily,new Date(window.end+'T04:00:00Z')) };
    }, { isolation: "REPEATABLE READ" }));
  });
  router.get("/key-signatures/datasets/:datasetId/records/:recordId", async (req: any, res: any) => {
    need(ID.test(req.params.datasetId) && ID.test(req.params.recordId), "标注切图 ID 无效");
    const r = (await pool.query("SELECT * FROM omr_key_records WHERE id=$1 AND dataset_id=$2", [req.params.recordId,req.params.datasetId])).rows[0];
    need(r, "标注切图不存在或不属于此数据集", 404);
    res.json(publicRecord(r));
  });  router.get("/key-signatures/datasets/:datasetId/editor", async (req: any, res: any) => {
    res.json(await transaction(pool, async (c: any) => {
      const d = await keyDataset(c, req.params.datasetId);
      const recordId = req.query.recordId;
      need(!recordId || (typeof recordId === "string" && ID.test(recordId)), "标注切图 ID 无效");
      need(!req.query.direction || ["previous", "next", "pending"].includes(req.query.direction), "切换方向无效");
      const queue = (await c.query("SELECT id,status FROM omr_key_records WHERE dataset_id=$1 ORDER BY sequence,id", [d.id])).rows;
      let index = recordId ? queue.findIndex((r: any) => r.id === recordId) : queue.findIndex((r: any) => r.status === "draft");
      if (recordId) need(index >= 0, "标注切图不存在或不属于此数据集", 404);
      if (index < 0) index = 0;
      if (req.query.direction === "previous") index = Math.max(0, index - 1);
      if (req.query.direction === "next") index = Math.min(queue.length - 1, index + 1);
      if (req.query.direction === "pending") {
        const following = queue.findIndex((r: any, i: number) => i > index && r.status === "draft");
        const first = queue.findIndex((r: any) => r.status === "draft");
        index = following >= 0 ? following : first >= 0 ? first : index;
      }
      const record = queue[index] ? (await c.query("SELECT * FROM omr_key_records WHERE id=$1 AND dataset_id=$2", [queue[index].id, d.id])).rows[0] : null;
      return { dataset: d, record: record ? publicRecord(record) : null, position: record ? index + 1 : 0,
        previousId: queue[index - 1]?.id || null, nextId: queue[index + 1]?.id || null };
    }, { isolation: "REPEATABLE READ" }));
  });
  router.put("/key-signatures/datasets/:datasetId/records/:recordId", async (req: any, res: any) => {
    need(ID.test(req.params.recordId), "标注切图 ID 无效");
    need(timeSignature ? timeSignatureComplete(req.body) : keyLabelComplete(req.body), "请选择标注和原调 / 选调");
    need(Number.isSafeInteger(req.body.version) && req.body.version > 0, "标注版本无效");
    res.json(await transaction(pool, async (c: any) => {
      await keyDataset(c, req.params.datasetId);
      const existing = (await c.query("SELECT id FROM omr_key_records WHERE id=$1 AND dataset_id=$2", [req.params.recordId, req.params.datasetId])).rows[0];
      need(existing, "标注切图不存在或不属于此数据集", 404);
      const result = await c.query(`UPDATE omr_key_records SET tonic=$1,kind=$2,status='confirmed',first_labeled_at=COALESCE(first_labeled_at,now()),version=version+1,updated_at=now()
        WHERE id=$3 AND dataset_id=$4 AND version=$5 RETURNING *`,
        [req.body[firstField], req.body[secondField], req.params.recordId, req.params.datasetId, req.body.version]);
      need(result.rowCount, "标注已被其他页面修改，请重新打开此数据集后重试", 409);
      await c.query("UPDATE omr_key_datasets SET updated_at=now() WHERE id=$1", [req.params.datasetId]);
      return publicRecord(result.rows[0]);
    }));
  });
  router.get("/key-signatures/datasets/:datasetId/records/:recordId/content", async (req: any, res: any) => {
    need(ID.test(req.params.recordId) && ID.test(req.params.datasetId), "标注切图 ID 无效");
    const r = (await pool.query(`SELECT r.*,i.object_key,i.coordinate,i.checksum FROM omr_key_records r
      JOIN omr_images i ON i.id=r.source_page_id JOIN omr_songs s ON s.id=i.song_id JOIN omr_datasets d ON d.id=s.dataset_id
      WHERE r.id=$1 AND r.dataset_id=$2 AND i.deleted_at IS NULL AND s.deleted_at IS NULL AND d.deleted_at IS NULL`,
      [req.params.recordId, req.params.datasetId])).rows[0];
    need(r, "切图来源已删除或不存在", 404);
    const data = await storage.get(r.coordinate?.working?.key || r.object_key);
    need(digest(data) === r.source_checksum, "切图来源内容已变化，无法读取原标注图片", 409);
    const png = await sharp(data, { limitInputPixels: 50000000 }).extract(r.rectangle).png().toBuffer();
    res.type("image/png").set("X-Checksum-Sha256", digest(png)).send(png);
  });
  router.get("/key-signatures/datasets/:datasetId/export", async (req: any, res: any) => {
    const result = await transaction(pool, async (c: any) => {
      const d = await keyDataset(c, req.params.datasetId);
      const rows = (await c.query("SELECT * FROM omr_key_records WHERE dataset_id=$1 AND status='confirmed' ORDER BY sequence,id", [d.id])).rows;
      return { schemaVersion: 1, task: timeSignature ? "time-signature" : "key-signature", dataset: d, ...(timeSignature ? {numerators:Array.from({length:32},(_,i)=>i+1),denominators:TIME_DENOMINATORS} : {tonics:KEY_TONICS,kinds:["original","play"]}),
        records: rows.map((r: any) => ({ ...r, imageUrl: `/api/v2/${resource}/datasets/${d.id}/records/${r.id}/content` })) };
    }, { isolation: "REPEATABLE READ" });
    const encoded = Buffer.from(JSON.stringify(result));
    res.set("X-Checksum-Sha256", digest(encoded));
    res.type("application/json").set("Content-Disposition", `attachment; filename="${req.params.datasetId}-${resource}.json"`).send(encoded);
  });
}