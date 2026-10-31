import { DELETION_LOCK, deletionBarrier } from "../deletion-lock.ts";
import type { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Readable } from "node:stream";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdtemp,
  writeFile,
  mkdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import { importRhythmPages } from "./rhythm-import.ts";
import { annotationWindow, annotationTrend, ANNOTATION_TREND_DAYS } from "../../../shared/annotation-trend.ts";
import type {
  Geometry,
  LocalizationRecord,
  SourcePage,
  Measure,
  LocEvent,
  Json,
} from "../../../shared/localization.ts";
import {
  insist,
  object,
  string,
  matrix,
  validateGeometry,
  fingerprint,
  finite,
  bbox,
} from "./geometry.ts";
interface Storage {
  get(key: string): Promise<Buffer>;
}
interface SourceRow {
  id: string;
  checksum: string;
  width: number;
  height: number;
  object_key: string;
  song_group_key: string;
  split: "train" | "val" | "test";
  deleted_at: string | null;
  song_deleted: string | null;
  dataset_deleted: string | null;
}
async function tx<T>(
  pool: Pool,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  let deletionHeld = false;
  try {
    await c.query("SELECT pg_advisory_lock_shared($1)", [DELETION_LOCK]);
    deletionHeld = true;
    await c.query("BEGIN");
    await deletionBarrier(c);
    const v = await fn(c);
    await c.query("COMMIT");
    return v;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    if (deletionHeld)
      await c
        .query("SELECT pg_advisory_unlock_shared($1)", [DELETION_LOCK])
        .catch(() => {});
    c.release();
  }
}
async function lock(c: PoolClient) {
  await c.query("SELECT pg_advisory_xact_lock(79142606)");
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
async function dataset(c: Pool | PoolClient, id: unknown) {
  insist(uuid(id), "定位数据集ID无效");
  const r = await c.query("SELECT * FROM omr_loc_datasets WHERE id=$1", [id]);
  insist(r.rowCount, "定位数据集不存在", 404);
  return r.rows[0] as { id: string; name: string; version: number; task: string; source_dataset_id: string | null };
}
async function source(
  c: Pool | PoolClient,
  id: unknown,
  lock = false,
): Promise<SourceRow> {
  insist(uuid(id), "来源页必须为平台UUID");
  const r = await c.query<SourceRow>(
    "SELECT i.id,i.checksum,i.width,i.height,i.object_key,i.deleted_at,s.song_group_key,s.split,s.deleted_at song_deleted,d.deleted_at dataset_deleted FROM omr_images i JOIN omr_songs s ON s.id=i.song_id JOIN omr_datasets d ON d.id=s.dataset_id WHERE i.id=$1" +
      (lock ? " FOR SHARE OF i,s,d" : ""),
    [id],
  );
  const p = r.rows[0];
  insist(
    p && !p.deleted_at && !p.song_deleted && !p.dataset_deleted,
    "来源原图不存在或已删除",
    410,
  );
  return p;
}
async function record(
  c: Pool | PoolClient,
  id: unknown,
  forUpdate = false,
): Promise<LocalizationRecord> {
  insist(uuid(id), "定位记录ID无效");
  const r = await c.query<LocalizationRecord>(
    "SELECT * FROM omr_loc_records WHERE id=$1" +
      (forUpdate ? " FOR UPDATE" : ""),
    [id],
  );
  insist(r.rowCount, "定位记录不存在", 404);
  return r.rows[0];
}
async function sourcesValid(
  c: Pool | PoolClient,
  r: LocalizationRecord,
  lock = false,
) {
  for (const p of r.geometry.pages) {
    const current = await source(c, p.sourcePageId, lock);
    insist(
      current.checksum === p.sourceSha &&
        current.width === p.width &&
        current.height === p.height,
      "原图SHA或尺寸变化，定位标签已失效",
      409,
    );
    insist(
      current.song_group_key === r.group_key && current.split === r.split,
      "来源曲组/split已变化，不能覆盖或确认",
      409,
    );
  }
}
async function noSplitLeak(
  c: PoolClient,
  datasetId: string,
  pages: SourcePage[],
  split: string,
  group: string,
) {
  const conflict = await c.query(
    "SELECT r.id FROM omr_loc_records r JOIN omr_loc_record_pages rp ON rp.record_id=r.id JOIN omr_images i ON i.id=rp.source_page_id JOIN omr_songs s ON s.id=i.song_id JOIN omr_datasets d ON d.id=s.dataset_id WHERE r.dataset_id=$1 AND r.split<>$2 AND (r.group_key=$3 OR rp.source_sha=ANY($4::text[])) AND i.deleted_at IS NULL AND s.deleted_at IS NULL AND d.deleted_at IS NULL AND i.checksum=rp.source_sha AND s.split=r.split AND s.song_group_key=r.group_key LIMIT 1",
    [datasetId, split, group, pages.map((p) => p.sourceSha)],
  );
  insist(!conflict.rowCount, "同曲组或同原图跨split，拒绝导入/确认/冻结", 409);
}
async function verifyObjects(
  c: PoolClient,
  r: LocalizationRecord,
  storage: Storage,
  seen = new Set<string>(),
) {
  for (const page of r.geometry.pages) {
    if (seen.has(page.sourcePageId)) continue;
    const p = await source(c, page.sourcePageId, true),
      bytes = await storage.get(p.object_key);
    insist(
      fingerprintBytes(bytes) === page.sourceSha,
      "来源原图字节SHA不匹配，几何不能确认或冻结",
      409,
    );
    seen.add(page.sourcePageId);
  }
}
function eventFrom(raw: unknown, voice: string): LocEvent {
  const e = object(raw);
  return {
    id: string(e.id, "事件ID"),
    voice:
      e.voice == null
        ? voice
        : typeof e.voice === "string" || finite(e.voice)
          ? String(e.voice)
          : string(e.voice, "事件声部", 80),
    centerX: finite(e.center_x) ? e.center_x : null,
    bbox: (e.bbox_xyxy ?? null) as LocEvent["bbox"],
    contextBBox: (e.context_bbox_xyxy ?? null) as LocEvent["contextBBox"],
    status:
      e.review_status === "rejected"
        ? "rejected"
        : e.review_status === "accepted"
          ? "accepted"
          : "candidate",
    confidence: finite(e.confidence) ? e.confidence : null,
    evidence: object(e.evidence ?? {}) as LocEvent["evidence"],
    annotationSource: object(
      e.annotation_source ?? {},
    ) as LocEvent["annotationSource"],
  };
}
export function registerLocalization(
  router: Router,
  { pool, storage }: { pool: Pool; storage: Storage },
) {
  router.get("/localization/datasets", async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT d.*,s.name source_name,count(r.id)::int record_count,count(r.id) FILTER(WHERE r.status='confirmed')::int confirmed_count FROM omr_loc_datasets d LEFT JOIN omr_datasets s ON s.id=d.source_dataset_id LEFT JOIN omr_loc_records r ON r.dataset_id=d.id GROUP BY d.id,s.name ORDER BY d.created_at DESC,d.id DESC",
        )
      ).rows,
    ),
  );
  router.post("/localization/datasets", async (req, res) =>
    res
      .status(201)
      .json(
        (
          await tx(pool,async c => {
            await lock(c);
            const task = req.body.task ?? "geometry";
            insist(["geometry","rhythm"].includes(task),"标注任务无效");
            const sourceId = req.body.sourceDatasetId ?? null;
            insist(sourceId === null || uuid(sourceId),"切图数据集ID无效");
            if (task === "rhythm") {
              insist(sourceId && (await c.query("SELECT id FROM omr_datasets WHERE id=$1 AND deleted_at IS NULL",[sourceId])).rowCount,"请选择有效的切图数据集");
            }
            const d = (await c.query("INSERT INTO omr_loc_datasets(id,name,description,task,source_dataset_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [randomUUID(),string(req.body.name,"名称"),String(req.body.description || "").slice(0,2000),task,sourceId])).rows[0];
            const imported = task === "rhythm" && sourceId ? await importRhythmPages(c,d.id,sourceId) : 0;
            return {...d,imported};
          })
        ),
      ),
  );
  router.post("/localization/datasets/:datasetId/sync",async(req,res) => res.json(await tx(pool,async c => {
    await lock(c); const d = await dataset(c,req.params.datasetId);
    insist(d.task === "rhythm" && d.source_dataset_id,"该数据集未关联切图来源");
    return {imported:await importRhythmPages(c,d.id,d.source_dataset_id)};
  })));
  router.get("/localization/datasets/:datasetId/editor",async(req,res) => {
    const d = await dataset(pool,req.params.datasetId), current = await record(pool,req.query.recordId);
    insist(current.dataset_id === d.id,"记录不属于此数据集",404);
    const status = String(req.query.status || ""), split = String(req.query.split || ""), search = String(req.query.search || "");
    insist(["","draft","confirmed"].includes(status) && ["","train","val","test"].includes(split) && search.length<=200,"队列筛选无效");
    const parameters = [d.id,current.id,status,split,search];
    const filters = "dataset_id=$1 AND ($3='' OR status=$3) AND ($4='' OR split=$4) AND ($5='' OR position(lower($5) in lower(title))>0 OR position(lower($5) in lower(corpus_id))>0)";
    // Read the timestamp cursor in PostgreSQL so JavaScript millisecond precision
    // cannot make a record its own neighbor or skip pages created in the same ms.
    const cursor = "(SELECT created_at,id FROM omr_loc_records WHERE id=$2::uuid)";
    const previous = (await pool.query(`SELECT id FROM omr_loc_records WHERE ${filters} AND (created_at,id)>${cursor} ORDER BY created_at,id LIMIT 1`,parameters)).rows[0];
    const next = (await pool.query(`SELECT id FROM omr_loc_records WHERE ${filters} AND (created_at,id)<${cursor} ORDER BY created_at DESC,id DESC LIMIT 1`,parameters)).rows[0];
    res.json({previousId:previous?.id ?? null,nextId:next?.id ?? null});
  });
  router.get("/localization/datasets/:datasetId/records", async (req, res) => {
    const ds = await dataset(pool, req.params.datasetId);
    const page = Number(req.query.page ?? 1),
      size = Number(req.query.pageSize ?? 50);
    insist(
      Number.isSafeInteger(page) &&
        page > 0 &&
        page < 1000000 &&
        [10, 25, 50, 100].includes(size),
      "分页无效",
    );
    const params: unknown[] = [req.params.datasetId];
    let where = "dataset_id=$1";
    for (const [key, column] of [
      ["status", "status"],
      ["split", "split"],
      ["source", "source"],
    ] as const)
      if (req.query[key]) {
        insist(
          typeof req.query[key] === "string" &&
            String(req.query[key]).length <= 200,
          "过滤条件无效",
        );
        params.push(req.query[key]);
        where += ` AND ${column}=$${params.length}`;
      }
    if (req.query.search) {
      params.push(string(req.query.search, "搜索"));
      where += ` AND (position(lower($${params.length}) in lower(title))>0 OR position(lower($${params.length}) in lower(corpus_id))>0)`;
    }
    const rows = await pool.query(
      `SELECT id,dataset_id,corpus_id,corpus_revision,title,group_key,split,source,status,version,updated_at,original->>'pageOrder' page_order,jsonb_array_length(geometry->'measures') measure_count,(SELECT COALESCE(sum(jsonb_array_length(m->'events')),0)::int FROM jsonb_array_elements(geometry->'measures') m) event_count FROM omr_loc_records WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (page - 1) * size],
    );
    const total = Number(
      (
        await pool.query(
          `SELECT count(*) n FROM omr_loc_records WHERE ${where}`,
          params,
        )
      ).rows[0].n,
    );
    const days = Number(req.query.trendDays || 30);
    insist((ANNOTATION_TREND_DAYS as readonly number[]).includes(days),"统计范围无效");
    const window = annotationWindow(days);
    const daily = (await pool.query(`SELECT to_char(first_labeled_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') date,count(*)::int count,0::int estimated
      FROM omr_loc_records WHERE dataset_id=$1 AND first_labeled_at>=($2::date::timestamp AT TIME ZONE 'Asia/Shanghai')
      AND first_labeled_at<(($3::date+interval '1 day') AT TIME ZONE 'Asia/Shanghai') GROUP BY 1 ORDER BY 1`,[ds.id,window.start,window.end])).rows;
    const stats = (await pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE status='confirmed')::int confirmed FROM omr_loc_records WHERE dataset_id=$1",[ds.id])).rows[0];
    res.json({ dataset:ds,stats,items: rows.rows, total, page, pageSize: size,annotationTrend:annotationTrend(days,daily,new Date(window.end+'T04:00:00Z')) });
  });
  router.post("/localization/datasets/:datasetId/import", async (req, res) =>
    res.status(200).json(
      await tx(pool, async (c) => {
        await lock(c);
        const ds = await dataset(c, req.params.datasetId);
        insist(ds.task !== "rhythm", "音符事件数据集请使用关联切图同步生成样本");
        insist(
          Object.keys(object(req.body)).every((k) =>
            [
              "corpus",
              "sourcePageMap",
              "pixelEquivalence",
              "geometry",
            ].includes(k),
          ),
          "不支持的导入顶层字段，请移入原始corpus附件或迁移报告",
        );
        const corpus = object(req.body.corpus),
          mapping = object(req.body.sourcePageMap),
          src = object(corpus.source);
        insist(
          corpus.version === "omr-event-corpus-v1",
          "仅支持omr-event-corpus-v1附件",
        );
        const corpusId = string(src.sample_id, "原语料sample_id"),
          revision = corpus.revision;
        insist(
          Number.isSafeInteger(revision) && Number(revision) > 0,
          "原语料revision无效",
        );
        insist(
          Array.isArray(src.pages) &&
            src.pages.length > 0 &&
            src.pages.length <= 100,
          "来源页须1–100张",
        );
        const pages: SourcePage[] = [],
          sourceRows: SourceRow[] = [];
        for (const raw of src.pages) {
          const p = object(raw),
            local = string(p.asset_id, "历史页ID");
          insist(!pages.some((p) => p.localPageId === local), "历史页ID重复");
          insist(
            typeof p.sha256 === "string" && /^[a-f0-9]{64}$/.test(p.sha256),
            "来源字节SHA256无效",
          );
          const actual = await source(c, mapping[local], true);
          let verifiedEquivalence: SourcePage["pixelEquivalence"];
          if (p.sha256 !== actual.checksum) {
            const equivalent = object(
              object(req.body.pixelEquivalence ?? {})[local] ?? {},
            );
            insist(
              equivalent.mode === "decoded-rgb-v1" &&
                equivalent.acknowledged === true &&
                equivalent.platformSha256 === actual.checksum &&
                equivalent.historicalSha256 === p.sha256 &&
                typeof equivalent.rgbSha256 === "string" &&
                /^[a-f0-9]{64}$/.test(equivalent.rgbSha256),
              "原图字节SHA不符，必须显式提交解码RGB等价证明",
              409,
            );
            const bytes = await storage.get(actual.object_key);
            insist(
              fingerprintBytes(bytes) === actual.checksum,
              "平台原图SHA不符",
              409,
            );
            const rgb = await sharp(bytes, { limitInputPixels: 50000000 })
              .removeAlpha()
              .toColourspace("srgb")
              .raw()
              .toBuffer();
            insist(
              fingerprintBytes(rgb) === equivalent.rgbSha256,
              "原图RGB像素SHA不匹配",
              409,
            );
            verifiedEquivalence = {
              mode: "decoded-rgb-v1",
              rgbSha256: equivalent.rgbSha256,
              platformSha256: actual.checksum,
              historicalSha256: String(p.sha256),
            };
          }
          insist(
            p.width === actual.width && p.height === actual.height,
            "来源原图尺寸不匹配",
            409,
          );
          const mat = matrix(
            p.coordinate_mapping ?? [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
          );
          insist(
            fingerprint(mat) ===
              fingerprint([
                [1, 0, 0],
                [0, 1, 0],
                [0, 0, 1],
              ]),
            "非恒等历史坐标映射需先显式转换到原图像素；未导入任何记录",
            422,
          );
          pages.push({
            localPageId: local,
            sourcePageId: actual.id,
            sourceSha: actual.checksum,
            pixelSha:
              typeof p.pixel_sha256 === "string" ? p.pixel_sha256 : null,
            width: actual.width,
            height: actual.height,
            mapping: mat,
            ...(verifiedEquivalence
              ? {
                  historicalSha: String(p.sha256),
                  pixelEquivalence: verifiedEquivalence,
                }
              : {}),
          });
          sourceRows.push(actual);
        }
        const group = string(src.group_id, "原曲组"),
          split = sourceRows[0].split;
        insist(
          sourceRows.every(
            (p) => p.song_group_key === group && p.split === split,
          ) && corpus.split === split,
          "来源原曲组/split不一致，拒绝数据泄漏",
          409,
        );
        await noSplitLeak(c, ds.id, pages, split, group);
        const sourceHash = fingerprint(
            pages
              .map((p) => ({
                sha: p.sourceSha,
                historicalSha: p.historicalSha || p.sourceSha,
              }))
              .sort(
                (a, b) =>
                  a.sha.localeCompare(b.sha) ||
                  a.historicalSha.localeCompare(b.historicalSha),
              ),
          ),
          inputHash = fingerprint({
            corpus,
            mapping,
            pixelEquivalence: req.body.pixelEquivalence ?? {},
            geometry: req.body.geometry ?? null,
          });
        const previous = await c.query<LocalizationRecord>(
          "SELECT * FROM omr_loc_records WHERE dataset_id=$1 AND corpus_id=$2 AND corpus_revision=$3 AND source_fingerprint=$4",
          [ds.id, corpusId, revision, sourceHash],
        );
        if (previous.rowCount) {
          insist(
            previous.rows[0].input_checksum === inputHash,
            "同语料revision来源键已有不同输入，不可覆盖",
            409,
          );
          return {
            record: previous.rows[0],
            idempotent: true,
            warnings: ["历史AI确认不是本平台人工确认；原附件只读保留"],
          };
        }
        insist(Array.isArray(corpus.measures), "measures须为数组");
        const measures: Measure[] = corpus.measures.map((raw) => {
          const m = object(raw),
            voice = String(m.voice ?? "1");
          return {
            id: string(m.id, "小节ID"),
            pageId: string(m.page_id, "历史页ID"),
            systemId: typeof m.system_id === "string" ? m.system_id : null,
            barNumber: Number.isSafeInteger(m.bar_number)
              ? Number(m.bar_number)
              : null,
            track: m.track as Measure["track"],
            voice,
            bbox: (m.bbox_xyxy ?? null) as Measure["bbox"],
            staffLines: (m.staff_lines ?? null) as Measure["staffLines"],
            events: Array.isArray(m.events)
              ? m.events.map((e) => eventFrom(e, voice))
              : [],
            geometryConfirmed: false,
            completenessConfirmed: false,
            reviewNote: "",
          };
        });
        const geometry = validateGeometry(
            req.body.geometry ?? {
              schemaVersion: "omr-localization-v1",
              pages,
              measures,
            },
            pages,
          ),
          id = randomUUID();
        const row = (
          await c.query<LocalizationRecord>(
            "INSERT INTO omr_loc_records(id,dataset_id,corpus_id,corpus_revision,source_fingerprint,input_checksum,original,geometry,title,group_key,split,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
            [
              id,
              ds.id,
              corpusId,
              revision,
              sourceHash,
              inputHash,
              corpus,
              geometry,
              typeof src.title === "string" ? src.title : corpusId,
              group,
              split,
              typeof object(corpus.provenance ?? {}).method === "string"
                ? object(corpus.provenance ?? {}).method
                : "historical-import",
            ],
          )
        ).rows[0];
        for (const p of pages)
          await c.query(
            "INSERT INTO omr_loc_record_pages VALUES($1,$2,$3,$4,$5,$6)",
            [
              id,
              p.localPageId,
              p.sourcePageId,
              p.sourceSha,
              p.pixelSha,
              JSON.stringify(p.mapping),
            ],
          );
        return {
          record: row,
          idempotent: false,
          warnings: [
            "导入默认待复核；原label/relations/texts和未知字段完整保留original",
            "pixelSha为原附件证据，当前校验原图字节SHA与尺寸，不推断像素哈希算法",
          ],
        };
      }),
    ),
  );
  router.get("/localization/records/:recordId", async (req, res) => {
    const r = await record(pool, req.params.recordId);
    await sourcesValid(pool, r);
    if (r.geometry.schemaVersion === "omr-rhythm-v1") r.geometry = validateGeometry(r.geometry,r.geometry.pages,{previous:r.geometry});
    res.json(r);
  });
  router.put("/localization/records/:recordId", async (req, res) =>
    res.json(
      await tx(pool, async (c) => {
        await lock(c);
        const r = await record(c, req.params.recordId, true);
        insist(
          req.body.version === r.version,
          "定位版本冲突，当前修改未保存",
          409,
        );
        await sourcesValid(c, r, true);
        const geometry = validateGeometry(req.body.geometry, r.geometry.pages, {
          previous: r.geometry,
        });
        insist(geometry.schemaVersion === r.geometry.schemaVersion,"不能修改记录的标注任务",409);
        insist(
          r.geometry.measures.every((m) =>
            geometry.measures.some((n) => n.id === m.id),
          ),
          "删除小节请使用永久删除预览与确认接口",
          409,
        );
        insist(
          r.geometry.measures.every((m) =>
            m.events.every((e) =>
              geometry.measures
                .find((n) => n.id === m.id)
                ?.events.some((v) => v.id === e.id),
            ),
          ),
          "删除事件请使用永久删除预览与确认接口",
          409,
        );
        const status =
          fingerprint(geometry) === fingerprint(r.geometry)
            ? r.status
            : "draft";
        return (
          await c.query(
            "UPDATE omr_loc_records SET geometry=$1,version=version+1,status=$2,confirmed_at=$3,updated_at=now() WHERE id=$4 RETURNING *",
            [
              geometry,
              status,
              status === "confirmed" ? r.confirmed_at : null,
              r.id,
            ],
          )
        ).rows[0];
      }),
    ),
  );
  for (const action of ["confirm", "unconfirm"])
    router.post("/localization/records/:recordId/" + action, async (req, res) =>
      res.json(
        await tx(pool, async (c) => {
          await lock(c);
          const r = await record(c, req.params.recordId, true);
          insist(req.body.version === r.version, "定位版本冲突", 409);
          await sourcesValid(c, r, true);
          if (action === "confirm") {
            insist(
              req.body.acknowledged === true,
              "请明确检查几何与人工完整性；不是内容真值确认",
            );
            await noSplitLeak(
              c,
              r.dataset_id,
              r.geometry.pages,
              r.split,
              r.group_key,
            );
            await verifyObjects(c, r, storage);
          }
          const geometry = validateGeometry(r.geometry, r.geometry.pages, {
            confirm: action === "confirm",
            previous: action === "unconfirm" ? undefined : r.geometry,
          });
          return (
            await c.query(
              "UPDATE omr_loc_records SET geometry=$1,status=$2,version=version+1,confirmed_at=$3,first_labeled_at=CASE WHEN $2='confirmed' THEN COALESCE(first_labeled_at,now()) ELSE first_labeled_at END,updated_at=now() WHERE id=$4 RETURNING *",
              [
                geometry,
                action === "confirm" ? "confirmed" : "draft",
                action === "confirm" ? new Date() : null,
                r.id,
              ],
            )
          ).rows[0];
        }),
      ),
    );
  for (const action of ["reject", "restore"])
    router.post(
      "/localization/records/:recordId/events/:eventId/" + action,
      async (req, res) =>
        res.json(
          await tx(pool, async (c) => {
            await lock(c);
            const r = await record(c, req.params.recordId, true);
            insist(req.body.version === r.version, "定位版本冲突", 409);
            await sourcesValid(c, r, true);
            const g = structuredClone(r.geometry),
              measure = g.measures.find((m) =>
                m.events.some((e) => e.id === req.params.eventId),
              );
            insist(measure, "事件ID不存在", 404);
            const event = measure.events.find(
              (e) => e.id === req.params.eventId,
            )!;
            insist(
              action === "reject"
                ? event.status !== "rejected"
                : event.status === "rejected",
              "事件状态已变化",
              409,
            );
            event.status = action === "reject" ? "rejected" : "candidate";
            measure.geometryConfirmed = measure.completenessConfirmed = false;
            return (
              await c.query(
                "UPDATE omr_loc_records SET geometry=$1,status='draft',version=version+1,confirmed_at=NULL,updated_at=now() WHERE id=$2 RETURNING *",
                [g, r.id],
              )
            ).rows[0];
          }),
        ),
    );
  router.get("/localization/sources/:pageId/content", async (req, res) => {
    const p = await source(pool, req.params.pageId),
      data = await storage.get(p.object_key);
    insist(fingerprintBytes(data) === p.checksum, "原图SHA不匹配", 409);
    const raw = await sharp(data, { limitInputPixels: 50000000 })
      .png()
      .toBuffer();
    res.type("png").set("X-Checksum-Sha256", fingerprintBytes(raw)).send(raw);
  });
  router.get(
    "/localization/datasets/:datasetId/snapshots",
    async (req, res) => {
      await dataset(pool, req.params.datasetId);
      res.json(
        (
          await pool.query(
            "SELECT id,fingerprint,created_at FROM omr_loc_snapshots WHERE dataset_id=$1 ORDER BY created_at DESC LIMIT 100",
            [req.params.datasetId],
          )
        ).rows,
      );
    },
  );
  router.post("/localization/datasets/:datasetId/snapshots", async (req, res) =>
    res.status(201).json(
      await tx(pool, async (c) => {
        await lock(c);
        const ds = await dataset(c, req.params.datasetId);
        const ids = req.body.recordIds;
        insist(
          ids === undefined ||
            (Array.isArray(ids) &&
              ids.length > 0 &&
              ids.length <= 100 &&
              ids.every(uuid) &&
              new Set(ids).size === ids.length),
          "recordIds须为1–100个不重复UUID",
        );
        const budget = (
          await c.query<{ n: string; bytes: string }>(
            "SELECT count(*) n,COALESCE(sum(octet_length(original::text)+octet_length(geometry::text)),0) bytes FROM omr_loc_records WHERE dataset_id=$1 AND status='confirmed'" +
              (ids ? " AND id=ANY($2::uuid[])" : ""),
            ids ? [ds.id, ids] : [ds.id],
          )
        ).rows[0];
        insist(
          Number(budget.n) > 0 &&
            Number(budget.n) <= 100 &&
            Number(budget.bytes) <= 8 * 1024 * 1024,
          "定位快照需要1–100份确认记录且来源/几何JSON不超过8MiB，请用recordIds分批",
        );
        const records = (
          await c.query<LocalizationRecord>(
            "SELECT * FROM omr_loc_records WHERE dataset_id=$1 AND status='confirmed'" +
              (ids ? " AND id=ANY($2::uuid[])" : "") +
              " ORDER BY id LIMIT 101",
            ids ? [ds.id, ids] : [ds.id],
          )
        ).rows;
        if (ids)
          insist(
            records.length === ids.length,
            "所选记录缺失、跨数据集或未确认",
            409,
          );
        insist(
          records.length > 0 && records.length <= 100,
          "每次定位快照需要1–100份确认语料",
        );
        const seen = new Set<string>();
        for (const r of records) {
          if (r.geometry.schemaVersion === "omr-rhythm-v1") r.geometry = validateGeometry(r.geometry,r.geometry.pages,{confirm:true});
          await sourcesValid(c, r, true);
          await noSplitLeak(
            c,
            r.dataset_id,
            r.geometry.pages,
            r.split,
            r.group_key,
          );
          await verifyObjects(c, r, storage, seen);
        }
        insist(
          records.reduce((n, r) => n + r.geometry.measures.length, 0) <= 3000,
          "快照最多3000小节轨道",
        );
        const frozen = {
            schemaVersion: ds.task === "rhythm" ? "omr-rhythm-snapshot-v1" : "omr-localization-snapshot-v1",
            dataset: ds,
            truth: ds.task === "rhythm" ? "geometry-and-event-category" : "geometry-only-not-musical-content",
            records,
          },
          hash = fingerprint(frozen),
          id = randomUUID();
        await c.query(
          "INSERT INTO omr_loc_snapshots(id,dataset_id,frozen,fingerprint) VALUES($1,$2,$3,$4)",
          [id, ds.id, frozen, hash],
        );
        return { id, fingerprint: hash };
      }),
    ),
  );
  router.get("/localization/snapshots/:snapshotId/:kind", async (req, res) => {
    insist(
      uuid(req.params.snapshotId) &&
        ["native", "crops"].includes(String(req.params.kind)),
      "快照下载参数无效",
    );
    const r = (
      await pool.query("SELECT * FROM omr_loc_snapshots WHERE id=$1", [
        req.params.snapshotId,
      ])
    ).rows[0] as
      | {
          id: string;
          frozen: { records: LocalizationRecord[]; truth?: string };
          fingerprint: string;
        }
      | undefined;
    insist(r, "定位快照不存在", 404);
    if (req.params.kind === "native") {
      const data = Buffer.from(
        JSON.stringify({ ...r.frozen, fingerprint: r.fingerprint }),
      );
      res
        .type("json")
        .set({
          "Content-Disposition": `attachment; filename="${r.id}.json"`,
          "Content-Length": String(data.length),
          "X-Checksum-Sha256": fingerprintBytes(data),
        })
        .send(data);
      return;
    }
    insist(!exportBusy, "定位裁片导出正忙，请稍后重试", 429);
    exportBusy = true;
    const dir = await mkdtemp(join(tmpdir(), "omr-loc-export-"));
    let activeZip: yazl.ZipFile | undefined;
    let completed: Promise<void> | undefined;
    try {
      let bytes = 0,
        index = 0,
        pixels = 0;
      const mappings: unknown[] = [];
      const measureFiles = new Map<string,string>();
      const zip = new yazl.ZipFile(),
        output = join(dir, "crops.zip"),
        done = pipeline(
          zip.outputStream,
          createWriteStream(output, { mode: 0o600 }),
        );
      activeZip = zip;
      completed = done;
      void done.catch(() => {});
      for (const record of r.frozen.records)
        for (const page of record.geometry.pages) {
          const rawPage = await pool.query<{ object_key: string }>(
            "SELECT object_key FROM omr_images WHERE id=$1",
            [page.sourcePageId],
          );
          insist(rawPage.rowCount, "冻结来源原图缺失", 409);
          const raw = await storage.get(rawPage.rows[0].object_key);
          insist(
            fingerprintBytes(raw) === page.sourceSha,
            "冻结来源原图SHA不符",
            409,
          );
          for (const measure of [
            ...(record.geometry.regions ?? []).filter(r => r.pageId === page.localPageId).map(r => ({id:r.id,track:r.track,bbox:r.bbox,events:[] as LocEvent[],isRegion:true})),
            ...record.geometry.measures.filter(m => m.pageId === page.localPageId).map(m => ({...m,isRegion:false})),
          ])
            for (const crop of [
              { kind: measure.isRegion ? "region" : "measure", id: measure.id, bbox: measure.bbox },
              ...measure.events
                .filter((e) => e.status !== "rejected")
                .map((e) => ({
                  kind: "event",
                  id: e.id,
                  bbox: e.bbox ?? e.contextBBox,
                })),
            ]) {
              if (!crop.bbox) continue;
              const b = bbox(crop.bbox, page, false)!;
              pixels += (b[2] - b[0]) * (b[3] - b[1]);
              insist(pixels <= 200000000, "裁片总像素超过2亿，请分批导出");
              const file = String(++index).padStart(6, "0") + ".png",
                dest = join(dir, file);
              await sharp(raw, { limitInputPixels: 50000000 })
                .extract({
                  left: b[0],
                  top: b[1],
                  width: b[2] - b[0],
                  height: b[3] - b[1],
                })
                .png()
                .toFile(dest);
              const data = await readFile(dest);
              bytes += data.length;
              insist(
                index <= 20000 && bytes < 512 * 1024 * 1024,
                "裁片导出超过512MB或20000张限制",
              );
              zip.addFile(dest, file, {
                mtime: new Date("2000-01-01T00:00:00Z"),
                mode: 0o100644,
              });
              if (crop.kind === "measure") measureFiles.set(record.id+":"+measure.id,file);
              const local = (box: number[]) => [box[0]-b[0],box[1]-b[1],box[2]-b[0],box[3]-b[1]];
              const eventAnnotations = (m: Measure) => m.events.filter(e => e.status !== "rejected").map(e => ({
                id:e.id,bbox:e.bbox ? local(e.bbox) : null,anchorX:e.centerX === null ? null : e.centerX-b[0],
                rhythm:e.rhythm ? {duration:m.track === "lyrics" ? null : e.rhythm.duration} : undefined,
              }));
              mappings.push({
                file,
                kind: crop.kind,
                id: crop.id,
                recordId: record.id,
                measureId: measure.id,
                sourcePageId: page.sourcePageId,
                sourceSha: page.sourceSha,
                bbox: b,
                localToSource: [[1,0,b[0]],[0,1,b[1]],[0,0,1]],
                track: measure.track,
                songGroupKey: record.group_key,
                split: record.split,
                ...(crop.kind === "region" ? {annotations:record.geometry.measures.filter(m => m.regionId === crop.id).map(m => ({
                  id:m.id,barNumber:m.barNumber,bbox:m.bbox ? local(m.bbox) : null,events:eventAnnotations(m),
                }))} : {}),
                ...(crop.kind === "measure" ? {events:eventAnnotations(measure as Measure),barNumber:(measure as Measure).barNumber} : {}),
                ...(crop.kind === "event" ? { rhythm:measure.events.find(e => e.id === crop.id)?.rhythm ? {duration:measure.track === "lyrics" ? null : measure.events.find(e => e.id === crop.id)!.rhythm!.duration} : undefined,
                  anchorX:measure.events.find(e => e.id === crop.id)?.centerX,
                  localAnchorX:(measure.events.find(e => e.id === crop.id)?.centerX ?? b[0])-b[0],
                  contextFile:measureFiles.get(record.id+":"+measure.id),
                  contextBBox:measure.events.find(e => e.id === crop.id)?.contextBBox ?? measure.bbox } : {}),
                sha256: fingerprintBytes(data),
              });
            }
        }
      zip.addBuffer(
        Buffer.from(
          JSON.stringify({
            schemaVersion: r.frozen.truth === "geometry-and-event-category" ? "omr-rhythm-crops-v1" : "omr-localization-crops-v1",
            snapshotId: r.id,
            fingerprint: r.fingerprint,
            truth: r.frozen.truth ?? "geometry-only-not-musical-content",
            crops: mappings,
          }),
        ),
        "manifest.json",
        { mtime: new Date("2000-01-01T00:00:00Z"), mode: 0o100644 },
      );
      zip.end();
      await done;
      const info = await stat(output);
      insist(info.size <= 512 * 1024 * 1024, "裁片ZIP超过512MiB，请分批导出");
      const checksum = await hashFile(output);
      res.type("zip").set({
        "Content-Disposition": `attachment; filename="${r.id}-crops.zip"`,
        "Content-Length": String(info.size),
        "X-Checksum-Sha256": checksum,
      });
      await pipeline(createReadStream(output), res);
    } finally {
      (activeZip?.outputStream as Readable | undefined)?.destroy();
      await completed?.catch(() => {});
      exportBusy = false;
      await rm(dir, { recursive: true, force: true });
    }
  });
}
import { createHash } from "node:crypto";
let exportBusy = false;
const fingerprintBytes = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");
async function hashFile(file: string) {
  const h = createHash("sha256");
  for await (const part of createReadStream(file)) h.update(part);
  return h.digest("hex");
}
