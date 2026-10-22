import { createHash } from "node:crypto";
import type {
  Geometry,
  Measure,
  XYXY,
  Json,
  SourcePage,
  Matrix3,
} from "../../../shared/localization.ts";
export class GeometryError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function insist(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new GeometryError(message, status);
}
export const fingerprint = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
function canonical(x: unknown): unknown {
  return x instanceof Date
    ? x.toISOString()
    : Array.isArray(x)
      ? x.map(canonical)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : x;
}
export function object(x: unknown): Record<string, unknown> {
  insist(
    x !== null && typeof x === "object" && !Array.isArray(x),
    "需要JSON对象",
  );
  return x as Record<string, unknown>;
}
export function string(x: unknown, name: string, max = 200): string {
  insist(
    typeof x === "string" &&
      x.length > 0 &&
      x.length <= max &&
      !/[\x00-\x1f]/.test(x),
    name + "无效",
  );
  return x;
}
export function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
export function matrix(x: unknown): Matrix3 {
  insist(
    Array.isArray(x) &&
      x.length === 3 &&
      x.every(
        (row) => Array.isArray(row) && row.length === 3 && row.every(finite),
      ),
    "坐标映射须为有限3x3矩阵",
  );
  const m = x as Matrix3;
  const [a, b, c] = m;
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  insist(Math.abs(det) > 1e-12, "坐标映射不可逆");
  return m;
}
export function bbox(
  x: unknown,
  page: SourcePage,
  nullable = true,
): XYXY | null {
  if (x == null) {
    insist(nullable, "确认需要完整小节框");
    return null;
  }
  insist(
    Array.isArray(x) && x.length === 4 && x.every(Number.isSafeInteger),
    "bbox必须为整数原图xyxy",
  );
  const b = x as XYXY;
  insist(
    b[0] >= 0 &&
      b[1] >= 0 &&
      b[2] > b[0] &&
      b[3] > b[1] &&
      b[2] <= page.width &&
      b[3] <= page.height,
    "bbox越界或零尺寸",
  );
  return [...b];
}
export function validateGeometry(
  input: unknown,
  pages: SourcePage[],
  {
    confirm = false,
    previous,
  }: { confirm?: boolean; previous?: Geometry } = {},
): Geometry {
  const raw = object(input);
  insist(
    Object.keys(raw).every((k) =>
      ["schemaVersion", "pages", "measures"].includes(k),
    ),
    "不支持的geometry字段，请保留在original附件",
  );
  insist(raw.schemaVersion === "omr-localization-v1", "定位schema版本无效");
  insist(
    Array.isArray(raw.measures) && raw.measures.length <= 1000,
    "每记录最多1000小节轨道",
  );
  insist(
    fingerprint(raw.pages) === fingerprint(pages),
    "原图引用/校验/映射不可由保存修改",
    409,
  );
  const ids = new Set<string>(),
    eventIds = new Set<string>();
  const measures: Measure[] = raw.measures.map((value) => {
    const m = object(value);
    insist(
      Object.keys(m).every((k) =>
        [
          "id",
          "pageId",
          "systemId",
          "barNumber",
          "track",
          "voice",
          "bbox",
          "staffLines",
          "events",
          "geometryConfirmed",
          "completenessConfirmed",
          "reviewNote",
        ].includes(k),
      ),
      "不支持的小节几何字段，请保留在original附件",
    );
    const id = string(m.id, "小节ID");
    insist(!ids.has(id), "小节ID重复");
    ids.add(id);
    const page = pages.find((p) => p.localPageId === m.pageId);
    insist(page, "小节来源页不存在");
    insist(
      m.track === "guitar" || m.track === "melody",
      "轨道只支持guitar/melody",
    );
    const voice = string(m.voice, "声部", 80),
      box = bbox(m.bbox, page, !confirm);
    let staffLines: number[] | null = null;
    if (m.staffLines != null) {
      insist(
        Array.isArray(m.staffLines) &&
          m.staffLines.length === 6 &&
          m.staffLines.every(finite),
        "弦线须为六个有限数值",
      );
      staffLines = [...m.staffLines] as number[];
      insist(
        staffLines.every(
          (y, i) =>
            y >= 0 && y <= page.height && (!i || y > staffLines![i - 1]),
        ),
        "六根弦线必须递增且不越界",
      );
      if (box)
        insist(
          staffLines.every((y) => y >= box[1] && y <= box[3]),
          "弦线超出小节框",
        );
    }
    if (confirm && m.track === "guitar")
      insist(staffLines, "吉他轨道确认需要六根弦线");
    insist(
      Array.isArray(m.events) && m.events.length <= 5000,
      "事件数组无效或过多",
    );
    const events = m.events.map((value) => {
      const e = object(value);
      insist(
        Object.keys(e).every((k) =>
          [
            "id",
            "voice",
            "centerX",
            "bbox",
            "contextBBox",
            "status",
            "evidence",
            "annotationSource",
            "confidence",
          ].includes(k),
        ),
        "不支持的事件几何字段，请保留在original附件",
      );
      const eid = string(e.id, "事件ID");
      insist(!eventIds.has(eid), "事件ID须在记录内唯一");
      eventIds.add(eid);
      insist(
        ["candidate", "accepted", "rejected"].includes(String(e.status)),
        "事件状态无效",
      );
      const center = e.centerX == null ? null : e.centerX;
      insist(
        center === null ||
          (finite(center) && center >= 0 && center <= page.width),
        "事件中心横坐标无效",
      );
      const eb = bbox(e.bbox, page),
        context = bbox(e.contextBBox, page);
      if (confirm && e.status !== "rejected") {
        insist(
          center !== null && box && center >= box[0] && center <= box[2],
          "有效事件需要位于小节中的横坐标",
        );
        if (eb)
          insist(center >= eb[0] && center <= eb[2], "事件裁片未包含事件中心");
        if (eb)
          insist(
            eb[0] >= box[0] &&
              eb[1] >= box[1] &&
              eb[2] <= box[2] &&
              eb[3] <= box[3],
            "事件裁片超出小节",
          );
        if (context)
          insist(
            center >= context[0] && center <= context[2],
            "上下文裁片未包含事件中心",
          );
      }
      return {
        id: eid,
        voice: string(e.voice ?? voice, "事件声部", 80),
        centerX: center as number | null,
        bbox: eb,
        contextBBox: context,
        status: e.status as "candidate" | "accepted" | "rejected",
        evidence: object(e.evidence ?? {}) as { [k: string]: Json },
        annotationSource: object(e.annotationSource ?? {}) as {
          [k: string]: Json;
        },
        confidence: finite(e.confidence) ? e.confidence : null,
      };
    });
    if (confirm) {
      const last = new Map<string, number>();
      for (const e of events.filter((e) => e.status !== "rejected")) {
        insist(e.centerX !== null, "事件缺少中心");
        insist(
          !last.has(e.voice) || e.centerX > last.get(e.voice)!,
          "同声部事件必须按横坐标严格递增",
        );
        last.set(e.voice, e.centerX);
      }
    }
    const result: Measure = {
      id,
      pageId: page.localPageId,
      systemId: m.systemId == null ? null : string(m.systemId, "谱行ID"),
      barNumber: m.barNumber == null ? null : Number(m.barNumber),
      track: m.track,
      voice,
      bbox: box,
      staffLines,
      events,
      geometryConfirmed: false,
      completenessConfirmed: false,
      reviewNote:
        typeof m.reviewNote === "string" ? m.reviewNote.slice(0, 4000) : "",
    };
    insist(
      result.barNumber === null ||
        (Number.isSafeInteger(result.barNumber) && result.barNumber > 0),
      "小节号无效",
    );
    const old = previous?.measures.find((p) => p.id === id);
    const shape = (v: Measure) => ({
      ...v,
      geometryConfirmed: false,
      completenessConfirmed: false,
      reviewNote: "",
    });
    if (old && fingerprint(shape(old)) === fingerprint(shape(result))) {
      result.geometryConfirmed = old.geometryConfirmed;
      result.completenessConfirmed = old.completenessConfirmed;
    }
    if (confirm) {
      result.geometryConfirmed = true;
      result.completenessConfirmed = true;
    }
    return result;
  });
  insist(
    measures.reduce((n, m) => n + m.events.length, 0) <= 20000,
    "记录事件总数过多",
  );
  if (confirm) insist(measures.length > 0, "没有可确认的小节");
  return { schemaVersion: "omr-localization-v1", pages, measures };
}
