import { createHash } from "node:crypto";
export const TAXONOMY = "layout-v1",
  LATEST_TAXONOMY = "layout-v2";
export const CATEGORIES = [
  ["system", "完整谱行", "#6d5eea"],
  ["guitar", "六线谱", "#228dce"],
  ["melody", "简谱", "#d89425"],
  ["lyrics", "歌词", "#26a17b"],
  ["chord_marks", "和弦/标记", "#dd6689"],
  ["staff_notation", "五线谱", "#777bc6"],
  ["other_tab", "其他谱表", "#89929e"],
].map(([key, name, color]: any, id: any) => ({
  id,
  cocoId: id + 1,
  key,
  name,
  color,
}));
export const METADATA_KEYS = [
  "title",
  "performer",
  "time_signature",
  "key_signature",
  "tempo",
  "capo",
];
export const ALL_CATEGORIES = [
  ...CATEGORIES,
  ...[
    ["title", "标题", "#9857cf"],
    ["performer", "歌手/演唱者", "#d06a42"],
    ["time_signature", "拍号", "#469ba7"],
    ["key_signature", "调号", "#b48b28"],
    ["tempo", "速度 / BPM", "#ba5d8f"],
    ["capo", "变调夹", "#6279b8"],
  ].map(([key, name, color]: any, i: any) => ({
    id: i + 7,
    cocoId: i + 8,
    key,
    name,
    color,
  })),
];
export const categoriesFor = (v: any) =>
  v === LATEST_TAXONOMY ? ALL_CATEGORIES : CATEGORIES;
export const digest = (data: any) =>
  createHash("sha256").update(data).digest("hex");
export const stable = (o: any): string =>
  Array.isArray(o)
    ? "[" + o.map(stable).join(",") + "]"
    : o && typeof o === "object"
      ? "{" +
        Object.keys(o)
          .filter((k: any) => o[k] !== undefined)
          .sort()
          .map((k: any) => JSON.stringify(k) + ":" + stable(o[k]))
          .join(",") +
        "}"
      : JSON.stringify(o);
export class Problem extends Error {
  status: number;
  details: unknown;
  constructor(message: any, status: any = 400, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export function need(
  ok: unknown,
  message: string,
  status = 400,
  details?: unknown,
): asserts ok {
  if (!ok) throw new Problem(message, status, details);
}
export const ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function regions(
  boxes: any,
  w: any,
  h: any,
  { confirm = false, pageType = "music", taxonomyVersion = TAXONOMY }: any = {},
) {
  need(Array.isArray(boxes) && boxes.length <= 5000, "最多5000个标注框");
  need(["music", "negative"].includes(pageType), "页类型无效");
  const ids = new Set();
  const result = boxes.map((b: any) => {
    need(
      b &&
        typeof b.id === "string" &&
        b.id.length > 0 &&
        b.id.length <= 100 &&
        !ids.has(b.id),
      "框ID无效或重复",
    );
    ids.add(b.id);
    need(
      ["x", "y", "width", "height"].every((k: any) =>
        Number.isSafeInteger(b[k]),
      ) &&
        b.x >= 0 &&
        b.y >= 0 &&
        b.width > 0 &&
        b.height > 0 &&
        b.x + b.width <= w &&
        b.y + b.height <= h,
      "框坐标超出工作图像或不是整数",
    );
    need(
      b.classKey === null ||
        categoriesFor(taxonomyVersion).some((c: any) => c.key === b.classKey),
      "类别与标注版本不匹配（历史框可暂未归类）",
    );
    need(
      b.parentSystemId === null || typeof b.parentSystemId === "string",
      "父谱行ID无效",
    );
    need(
      Number.isSafeInteger(b.readingOrder) && b.readingOrder >= 0,
      "阅读顺序必须是非负整数",
    );
    need(
      b.reviewStatus === undefined ||
        ["draft", "needs_adjustment", "confirmed"].includes(b.reviewStatus),
      "区域复核状态无效",
    );
    const metadata = validateMetadata(b, taxonomyVersion);
    return {
      ...(b.reviewStatus !== undefined ? { reviewStatus: b.reviewStatus } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      id: b.id,
      classKey: b.classKey,
      parentSystemId: b.parentSystemId,
      readingOrder: b.readingOrder,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    };
  });
  for (const b of result) {
    if (b.classKey === "system")
      need(b.parentSystemId === null, "完整谱行不能有父框");
    if (b.parentSystemId !== null) {
      const p = result.find((r: any) => r.id === b.parentSystemId);
      need(
        p && p.classKey === "system" && p.id !== b.id,
        "父框必须是本页完整谱行",
      );
      need(
        b.x >= p.x &&
          b.y >= p.y &&
          b.x + b.width <= p.x + p.width &&
          b.y + b.height <= p.y + p.height,
        "父谱行必须包含子区域",
      );
    }
    if (confirm) {
      need(b.classKey !== null, "历史未归类框不能确认");
      if (!["system", "chord_marks", ...METADATA_KEYS].includes(b.classKey))
        need(b.parentSystemId !== null, "子区域必须选择所属谱行");
    }
  }
  if (confirm)
    need(
      pageType === "negative" ? result.length === 0 : result.length > 0,
      "音乐页必须有区域；负样本必须无框并明确确认",
    );
  return result;
}
export function canonicalAnnotation(boxes: any, pageType: any) {
  const shape = (b: any) => ({
    classKey: b.classKey,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    readingOrder: b.readingOrder,
    ...(b.metadata !== undefined ? { metadata: b.metadata } : {}),
  });
  const ordered = (a: any) =>
    a.sort((a: any, b: any) => stable(a).localeCompare(stable(b), "en"));
  return stable({
    pageType,
    roots: ordered(
      boxes
        .filter((b: any) => b.parentSystemId === null)
        .map((b: any) => ({
          ...shape(b),
          children: ordered(
            boxes.filter((c: any) => c.parentSystemId === b.id).map(shape),
          ),
        })),
    ),
  });
}
export function validateMetadata(box: any, version: any) {
  if (!METADATA_KEYS.includes(box.classKey)) {
    need(box.metadata === undefined, "仅元信息框可填写元信息内容");
    return undefined;
  }
  need(version === LATEST_TAXONOMY, "元信息选区需要layout-v2");
  const m = box.metadata ?? {};
  need(m && typeof m === "object" && !Array.isArray(m), "元信息内容无效");
  need(
    Object.keys(m).every((k: any) => ["rawText", "scope", "value"].includes(k)),
    "元信息含未知字段",
  );
  const scope = m.scope ?? "page";
  need(["page", "global", "local"].includes(scope), "元信息范围无效");
  if (["title", "performer", "capo"].includes(box.classKey))
    need(scope !== "local", "此元信息只支持页级或全局范围");
  need(
    scope === "local" || box.parentSystemId === null,
    "页级/全局元信息不应关联谱行",
  );
  if (m.rawText !== undefined)
    need(
      typeof m.rawText === "string" &&
        m.rawText.length <= 4000 &&
        !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(m.rawText),
      "原文无效或过长",
    );
  const result: any = {
    scope,
    ...(m.rawText !== undefined ? { rawText: m.rawText } : {}),
  };
  if (m.value !== undefined) {
    const v = m.value;
    need(v && typeof v === "object" && !Array.isArray(v), "结构化值须是对象");
    const fieldLists: Record<string, string[]> = {
      title: ["text"],
      performer: ["name", "role"],
      time_signature: ["numerator", "denominator"],
      key_signature: ["kind", "tonic"],
      tempo: ["bpm", "beatUnit", "dotted"],
      capo: ["fret"],
    };
    const allowed = fieldLists[box.classKey];
    need(
      Object.keys(v).every((k: any) => allowed.includes(k)),
      "结构化值含未知字段",
    );
    for (const [k, value] of Object.entries(v)) {
      if (["text", "name", "tonic"].includes(k))
        need(
          typeof value === "string" && value.length <= 2000,
          "结构化文本无效",
        );
      else if (k === "role")
        need(value === "performer", "演唱者不能混为词曲作者或编配者");
      else if (k === "kind")
        need(
          ["original", "written", "play"].includes(value as never),
          "调性角色无效",
        );
      else if (k === "dotted")
        need(typeof value === "boolean", "附点须为布尔值");
      else if (k === "beatUnit")
        need([1, 2, 4, 8, 16, 32, 64].includes(value as never), "拍单位无效");
      else if (k === "bpm")
        need(
          typeof value === "number" &&
            Number.isFinite(value) &&
            value > 0 &&
            value <= 1000,
          "BPM范围无效",
        );
      else if (k === "fret")
        need(
          typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 0 &&
            value <= 24,
          "变调夹品位须为0–24，未注明请留空",
        );
      else if (k === "numerator")
        need(
          typeof value === "number" &&
            Number.isInteger(value) &&
            value > 0 &&
            value <= 64,
          "拍号分子无效",
        );
      else if (k === "denominator")
        need([1, 2, 4, 8, 16, 32, 64].includes(value as never), "拍号分母无效");
    }
    result.value = { ...v };
  }
  return result;
}
