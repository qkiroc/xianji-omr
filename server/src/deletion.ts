import { randomUUID, createHash } from "node:crypto";
import { need, ID } from "./annotation.ts";
import { DELETION_LOCK } from "./deletion-lock.ts";
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const kinds = [
  "dataset",
  "song",
  "page",
  "region",
  "locDataset",
  "locRecord",
  "snapshot",
  "locSnapshot",
  "locMeasure",
  "locEvent",
];
type Input = { kind: string; ids: string[]; regionIds?: string[] };
function input(raw: any): Input {
  need(raw && kinds.includes(raw.kind), "删除类型无效");
  need(
    Object.keys(raw).every((k) => ["kind", "ids", "regionIds"].includes(k)),
    "删除预览字段无效",
  );
  if (!["region", "locMeasure", "locEvent"].includes(raw.kind))
    need(raw.regionIds === undefined, "regionIds仅用于区域、小节或事件删除");
  need(
    Array.isArray(raw.ids) &&
      raw.ids.length > 0 &&
      raw.ids.length <= 100 &&
      new Set(raw.ids).size === raw.ids.length &&
      raw.ids.every((id: any) => ID.test(id)),
    "请选择1–100个不同标识",
  );
  if (["region", "locMeasure", "locEvent"].includes(raw.kind))
    need(
      raw.ids.length === 1 &&
        Array.isArray(raw.regionIds) &&
        raw.regionIds.length > 0 &&
        raw.regionIds.length <= 5000 &&
        new Set(raw.regionIds).size === raw.regionIds.length &&
        raw.regionIds.every(
          (id: any) =>
            typeof id === "string" &&
            id.length > 0 &&
            id.length <= 200 &&
            !/[\x00-\x1f]/.test(id),
        ),
      "区域删除参数无效",
    );
  return {
    kind: raw.kind,
    ids: [...raw.ids].sort(),
    ...(["region", "locMeasure", "locEvent"].includes(raw.kind)
      ? { regionIds: [...raw.regionIds].sort() }
      : {}),
  };
}
export function createDeletionService({ pool, storage, config }: any) {
  let working = false;
  async function locked<T>(fn: (c: any) => Promise<T>) {
    const c = await pool.connect();
    try {
      await c.query("SELECT pg_advisory_lock($1)", [DELETION_LOCK]);
      return await fn(c);
    } finally {
      await c
        .query("SELECT pg_advisory_unlock($1)", [DELETION_LOCK])
        .catch(() => {});
      c.release();
    }
  }
  async function plan(c: any, s: Input) {
    const table: Record<string, string> = {
      dataset: "omr_datasets",
      song: "omr_songs",
      page: "omr_images",
      region: "omr_images",
      locDataset: "omr_loc_datasets",
      locRecord: "omr_loc_records",
      snapshot: "omr_snapshots",
      locSnapshot: "omr_loc_snapshots",
      locMeasure: "omr_loc_records",
      locEvent: "omr_loc_records",
    };
    const targets = (
      await c.query(
        `SELECT id,${["snapshot", "locSnapshot"].includes(s.kind) ? "md5(frozen::text) version" : "version"} FROM ${table[s.kind]} WHERE id=ANY($1::uuid[]) ORDER BY id`,
        [s.ids],
      )
    ).rows;
    need(targets.length === s.ids.length, "待删除记录不存在或已永久删除", 404);
    const ds = s.kind === "dataset" ? s.ids : [],
      songs =
        s.kind === "song"
          ? s.ids
          : s.kind === "dataset"
            ? (
                await c.query(
                  "SELECT id FROM omr_songs WHERE dataset_id=ANY($1::uuid[]) ORDER BY id",
                  [s.ids],
                )
              ).rows.map((r: any) => r.id)
            : [];
    const pageColumns =
      "id,version,song_id,object_key,coordinate,jsonb_array_length(boxes) box_count" +
      (s.kind === "region" ? ",boxes" : "");
    const pages =
      s.kind === "page" || s.kind === "region"
        ? (
            await c.query(
              "SELECT " +
                pageColumns +
                " FROM omr_images WHERE id=ANY($1::uuid[]) ORDER BY id",
              [s.ids],
            )
          ).rows
        : songs.length
          ? (
              await c.query(
                "SELECT " +
                  pageColumns +
                  " FROM omr_images WHERE song_id=ANY($1::uuid[]) ORDER BY id",
                [songs],
              )
            ).rows
          : [];
    need(pages.length <= 10000, "单次删除最多10000张原图");
    if (s.kind === "region")
      need(
        s.regionIds!.every((id) =>
          pages[0].boxes.some((b: any) => b.id === id),
        ),
        "选区已变化，请刷新",
        409,
      );
    if (s.kind !== "region" && pages.length) {
      for (;;) {
        const sharedKeys = [
          ...new Set(
            pages.flatMap((p: any) =>
              [
                p.object_key,
                p.coordinate?.original?.key,
                p.coordinate?.working?.key,
              ].filter(Boolean),
            ),
          ),
        ];
        const extra = (
          await c.query(
            "SELECT " +
              pageColumns +
              " FROM omr_images WHERE id<>ALL($1::uuid[]) AND (object_key=ANY($2::text[]) OR coordinate->'working'->>'key'=ANY($2::text[])) ORDER BY id",
            [pages.map((p: any) => p.id), sharedKeys],
          )
        ).rows;
        if (!extra.length) break;
        pages.push(...extra);
        need(pages.length <= 10000, "单次级联最多10000张原图");
      }
      pages.sort((a: any, b: any) => a.id.localeCompare(b.id));
    }
    const pageIds = pages.map((p: any) => p.id);
    const keyRecords = (await c.query(
      "SELECT id,dataset_id,version FROM omr_key_records WHERE source_page_id=ANY($1::uuid[]) ORDER BY id",
      [s.kind === "region" ? [] : pageIds],
    )).rows;
    const timeRecords = (await c.query("SELECT id,dataset_id,version FROM omr_time_records WHERE source_page_id=ANY($1::uuid[]) ORDER BY id", [s.kind === "region" ? [] : pageIds])).rows;
    const locDs = s.kind === "locDataset" ? s.ids : [];
    const records = (
      await c.query(
        `SELECT id,dataset_id,version FROM omr_loc_records WHERE id=ANY($1::uuid[]) OR dataset_id=ANY($2::uuid[]) OR id IN (SELECT record_id FROM omr_loc_record_pages WHERE source_page_id=ANY($3::uuid[])) ORDER BY id`,
        [
          ["locRecord", "locMeasure", "locEvent"].includes(s.kind) ? s.ids : [],
          locDs,
          s.kind === "region" ? [] : pageIds,
        ],
      )
    ).rows;
    if (["locMeasure", "locEvent"].includes(s.kind)) {
      const geometry = (
        await c.query("SELECT geometry FROM omr_loc_records WHERE id=$1", [
          s.ids[0],
        ])
      ).rows[0].geometry;
      need(
        s.regionIds!.every((id) =>
          s.kind === "locMeasure"
            ? geometry.measures.some((m: any) => m.id === id)
            : geometry.measures.some((m: any) =>
                m.events.some((e: any) => e.id === id),
              ),
        ),
        "小节已变化，请刷新",
        409,
      );
    }
    const recordIds = records.map((r: any) => r.id);
    const terms = [...pageIds, ...songs, ...recordIds].map(
      (id) => '%"' + id + '"%',
    );
    const snapshots = (
      await c.query(
        "SELECT id,dataset_id,status,artifacts,md5(frozen::text) version FROM omr_snapshots WHERE id=ANY($1::uuid[]) OR dataset_id=ANY($2::uuid[]) OR frozen::text LIKE ANY($3::text[]) ORDER BY id",
        [s.kind === "snapshot" ? s.ids : [], ds, terms],
      )
    ).rows;
    need(
      snapshots.every((r: any) => r.status !== "preparing"),
      "关联快照正在生成，请结束后重新确认删除",
      409,
    );
    const locSnapshots = (
      await c.query(
        "SELECT id,dataset_id,md5(frozen::text) version FROM omr_loc_snapshots WHERE id=ANY($1::uuid[]) OR dataset_id=ANY($2::uuid[]) OR frozen::text LIKE ANY($3::text[]) ORDER BY id",
        [s.kind === "locSnapshot" ? s.ids : [], locDs, terms],
      )
    ).rows;
    const keys = new Set<string>();
    if (s.kind !== "region")
      for (const p of pages) {
        keys.add(p.object_key);
        for (const x of ["original", "working", "thumbnail"])
          if (p.coordinate?.[x]?.key) keys.add(p.coordinate[x].key);
      }
    for (const snap of snapshots)
      for (const a of Object.values(snap.artifacts || {}) as any[])
        if (a?.key) keys.add(a.key);
    need(
      [...keys].every(
        (k) =>
          typeof k === "string" &&
          k.startsWith(config.oss.prefix) &&
          !k.includes(".."),
      ),
      "对象路径不属于本应用，停止删除",
      409,
    );
    return {
      input: s,
      targets,
      datasets: ds,
      songs,
      pages: pages.map((p: any) => ({
        id: p.id,
        songId: p.song_id,
        version: p.version,
        boxes: p.box_count || 0,
      })),
      keyRecords, timeRecords,
      locDatasets: locDs,
      records,
      snapshots,
      locSnapshots,
      keys: [...keys].sort(),
      summary: {
        events: s.kind === "locEvent" ? s.regionIds!.length : 0,
        measures: s.kind === "locMeasure" ? s.regionIds!.length : 0,
        datasets: ds.length + locDs.length,
        songs: songs.length,
        pages: s.kind === "region" ? 0 : pages.length,
        regions:
          s.kind === "region"
            ? s.regionIds!.length
            : pages.reduce((n: number, p: any) => n + (p.box_count || 0), 0),
        localizationRecords: ["locMeasure", "locEvent"].includes(s.kind)
          ? 0
          : records.length,
        snapshots: snapshots.length + locSnapshots.length,
        keySignatureRecords: keyRecords.length,
        timeSignatureRecords: timeRecords.length,
        objects: keys.size,
      },
    };
  }
  async function preview(raw: any) {
    const s = input(raw);
    return locked(async (c) => {
      await c.query(
        "DELETE FROM omr_deletion_jobs WHERE status='planned' AND created_at<now()-interval '10 minutes'",
      );
      need(
        !(
          await c.query(
            "SELECT 1 FROM omr_deletion_jobs WHERE status IN ('pending','failed') LIMIT 1",
          )
        ).rowCount,
        "已有永久清理任务未完成，请先重试",
        503,
      );
      const p = await plan(c, s),
        id = randomUUID();
      await c.query(
        "INSERT INTO omr_deletion_jobs(id,input,plan,status) VALUES($1,$2,$3,'planned')",
        [id, s, p],
      );
      return {
        token: id,
        summary: p.summary,
        irreversible: true,
        expiresInSeconds: 300,
      };
    });
  }
  async function run(id: string, acknowledged: boolean, retry = false) {
    need(ID.test(id), "清理任务ID无效");
    return locked(async (c) => {
      let row = (
        await c.query("SELECT * FROM omr_deletion_jobs WHERE id=$1", [id])
      ).rows[0];
      need(row, "清理任务不存在", 404);
      if (row.status === "done")
        return { deleted: true, jobId: id, summary: row.plan.summary };
      if (row.status === "planned") {
        need(!retry && acknowledged === true, "必须明确确认不可恢复的级联删除");
        need(
          Date.now() - new Date(row.created_at).getTime() <= 300000,
          "删除预览已过期，请重新预览",
          409,
        );
        need(
          !(
            await c.query(
              "SELECT 1 FROM omr_deletion_jobs WHERE status IN ('pending','failed') LIMIT 1",
            )
          ).rowCount,
          "另一个清理任务未完成",
          409,
        );
        const current = await plan(c, row.input);
        need(
          hash(current) === hash(row.plan),
          "影响范围或版本已变化，请重新预览确认",
          409,
        );
        await c.query(
          "UPDATE omr_deletion_jobs SET status='pending',updated_at=now() WHERE id=$1",
          [id],
        );
        row = { ...row, status: "pending" };
      }
      let phase = "OSS";
      try {
        for (const key of row.plan.keys) {
          if (storage.deletePermanently) await storage.deletePermanently(key);
          else await storage.delete(key);
        }
        phase = "DB";
        await c.query("BEGIN");
        await c.query("SELECT set_config('omr.permanent_delete','on',true)");
        const p = row.plan;
        await c.query(
          "DELETE FROM omr_loc_snapshots WHERE id=ANY($1::uuid[])",
          [p.locSnapshots.map((r: any) => r.id)],
        );
        await c.query("DELETE FROM omr_snapshots WHERE id=ANY($1::uuid[])", [
          p.snapshots.map((r: any) => r.id),
        ]);
        if (!["locMeasure", "locEvent"].includes(p.input.kind)) {
          await c.query(
            "DELETE FROM omr_loc_record_pages WHERE record_id=ANY($1::uuid[])",
            [p.records.map((r: any) => r.id)],
          );
          await c.query(
            "DELETE FROM omr_loc_records WHERE id=ANY($1::uuid[])",
            [p.records.map((r: any) => r.id)],
          );
          await c.query(
            "DELETE FROM omr_loc_datasets WHERE id=ANY($1::uuid[])",
            [p.locDatasets],
          );
        }
        if (["locMeasure", "locEvent"].includes(p.input.kind)) {
          const record = (
            await c.query(
              "SELECT geometry,original FROM omr_loc_records WHERE id=$1",
              [p.input.ids[0]],
            )
          ).rows[0];
          const removed = new Set(p.input.regionIds);
          if (p.input.kind === "locMeasure")
            record.geometry.measures = record.geometry.measures.filter(
              (m: any) => !removed.has(m.id),
            );
          if (p.input.kind === "locEvent")
            for (const m of record.geometry.measures) {
              if (m.events.some((e: any) => removed.has(e.id))) {
                m.events = m.events.filter((e: any) => !removed.has(e.id));
                m.geometryConfirmed = false;
                m.completenessConfirmed = false;
              }
            }
          if (
            p.input.kind === "locEvent" &&
            Array.isArray(record.original.measures)
          )
            for (const m of record.original.measures)
              if (Array.isArray(m.events))
                m.events = m.events.filter((e: any) => !removed.has(e.id));
          if (
            p.input.kind === "locMeasure" &&
            Array.isArray(record.original.measures)
          )
            record.original.measures = record.original.measures.filter(
              (m: any) => !removed.has(m.id),
            );
          for (const name of ["relations", "texts"])
            if (Array.isArray(record.original[name]))
              record.original[name] = record.original[name].filter(
                (v: any) =>
                  !p.input.regionIds.some((id: string) =>
                    JSON.stringify(v).includes(JSON.stringify(id)),
                  ),
              );
          await c.query(
            "UPDATE omr_loc_records SET geometry=$1,original=$2,status='draft',confirmed_at=NULL,version=version+1,updated_at=now() WHERE id=$3",
            [record.geometry, record.original, p.input.ids[0]],
          );
        }
        await c.query("DELETE FROM omr_time_records WHERE id=ANY($1::uuid[])", [(p.timeRecords || []).map((r: any) => r.id)]);
        await c.query("UPDATE omr_time_datasets SET source_dataset_id=NULL,updated_at=now() WHERE source_dataset_id=ANY($1::uuid[])", [p.datasets]);
        await c.query("DELETE FROM omr_key_records WHERE id=ANY($1::uuid[])", [
          (p.keyRecords || []).map((r: any) => r.id),
        ]);
        await c.query("UPDATE omr_key_datasets SET source_dataset_id=NULL,updated_at=now() WHERE source_dataset_id=ANY($1::uuid[])", [p.datasets]);
          await c.query("UPDATE omr_loc_datasets SET source_dataset_id=NULL,updated_at=now() WHERE source_dataset_id=ANY($1::uuid[])", [p.datasets]);
        if (p.input.kind === "region") {
          const page = (
            await c.query("SELECT boxes FROM omr_images WHERE id=$1", [
              p.input.ids[0],
            ])
          ).rows[0];
          const removed = new Set(p.input.regionIds),
            boxes = page.boxes
              .filter((b: any) => !removed.has(b.id))
              .map((b: any) =>
                removed.has(b.parentSystemId)
                  ? { ...b, parentSystemId: null, reviewStatus: "draft" }
                  : b,
              );
          await c.query(
            "UPDATE omr_images SET boxes=$1,legacy_boxes=NULL,deleted_boxes='[]',status='draft',version=version+1,updated_at=now() WHERE id=$2",
            [JSON.stringify(boxes), p.input.ids[0]],
          );
        } else
          await c.query("DELETE FROM omr_images WHERE id=ANY($1::uuid[])", [
            p.pages.map((r: any) => r.id),
          ]);
        await c.query(
          "UPDATE omr_datasets SET version=version+1,updated_at=now() WHERE id IN (SELECT dataset_id FROM omr_songs WHERE id=ANY($1::uuid[]))",
          [p.pages.map((r: any) => r.songId)],
        );
        await c.query(
          "UPDATE omr_songs SET version=version+1 WHERE id=ANY($1::uuid[])",
          [p.pages.map((r: any) => r.songId)],
        );
        await c.query(
          "UPDATE omr_loc_datasets SET version=version+1,updated_at=now() WHERE id=ANY($1::uuid[])",
          [p.records.map((r: any) => r.dataset_id)],
        );
        await c.query("DELETE FROM omr_songs WHERE id=ANY($1::uuid[])", [
          p.songs,
        ]);
        await c.query("DELETE FROM omr_datasets WHERE id=ANY($1::uuid[])", [
          p.datasets,
        ]);
        await c.query(
          "UPDATE omr_deletion_jobs SET status='done',input='{}',plan=$1,updated_at=now() WHERE id=$2",
          [{ summary: p.summary }, id],
        );
        await c.query("COMMIT");
        return { deleted: true, jobId: id, summary: p.summary };
      } catch {
        await c.query("ROLLBACK").catch(() => {});
        await c
          .query(
            "UPDATE omr_deletion_jobs SET status='failed',updated_at=now() WHERE id=$1 AND status<>'done'",
            [id],
          )
          .catch(() => {});
        const saved = await c
          .query("SELECT status,plan FROM omr_deletion_jobs WHERE id=$1", [id])
          .catch(() => ({ rows: [] }));
        if (saved.rows[0]?.status === "done")
          return {
            deleted: true,
            jobId: id,
            summary: saved.rows[0].plan.summary,
          };
        const e: any = new Error(
          (phase === "OSS"
            ? "OSS永久清理未完成，请检查删除、版本查询/列举权限及保留策略；"
            : "数据库永久清理未完成，请检查数据库状态；") +
            "未显示成功，请重试清理任务 " +
            id,
        );
        e.status = 503;
        throw e;
      }
    });
  }
  async function recover() {
    if (working) return;
    working = true;
    try {
      const rows = (
        await pool.query(
          "SELECT id FROM omr_deletion_jobs WHERE status IN ('pending','failed') ORDER BY created_at LIMIT 10",
        )
      ).rows;
      for (const r of rows) await run(r.id, false, true).catch(() => {});
    } finally {
      working = false;
    }
  }
  return { preview, run, recover };
}
export function registerDeletion(router: any, deps: any) {
  const service = createDeletionService(deps);
  router.post("/deletions/preview", async (req: any, res: any) =>
    res.json(await service.preview(req.body)),
  );
  router.post("/deletions/execute", async (req: any, res: any) =>
    res.json(await service.run(req.body.token, req.body.acknowledged)),
  );
  router.post("/deletions/:jobId/retry", async (req: any, res: any) =>
    res.json(await service.run(req.params.jobId, false, true)),
  );
  router.get("/deletions", async (_req: any, res: any) =>
    res.json(
      (
        await deps.pool.query(
          "SELECT id,status,plan->'summary' summary,created_at,updated_at FROM omr_deletion_jobs WHERE status IN ('pending','failed') ORDER BY created_at",
        )
      ).rows,
    ),
  );
  return service;
}
