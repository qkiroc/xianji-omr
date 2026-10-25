import { ALL_CATEGORIES, categoriesFor, need } from "./annotation.ts";
export function exportSelection(classKeys: unknown, artifactKinds: unknown) {
  need(classKeys === undefined || (Array.isArray(classKeys) && classKeys.length > 0 &&
    classKeys.length <= ALL_CATEGORIES.length && new Set(classKeys).size === classKeys.length &&
    classKeys.every((key) => ALL_CATEGORIES.some((c) => c.key === key))), "导出类别无效，请使用taxonomy中的类别key");
  need(artifactKinds === undefined || (Array.isArray(artifactKinds) && artifactKinds.length > 0 &&
    artifactKinds.length <= 2 && new Set(artifactKinds).size === artifactKinds.length &&
    artifactKinds.every((kind) => ["detection", "crops"].includes(kind))), "导出类型仅支持detection、crops");
  return {
    ...(classKeys === undefined ? {} : { classKeys: ALL_CATEGORIES.filter((c) => (classKeys as string[]).includes(c.key)).map((c) => c.key) }),
    ...(artifactKinds === undefined ? {} : { artifactKinds: ["detection", "crops"].filter((k) => (artifactKinds as string[]).includes(k)) }),
  };
}
export const selectedBoxes = (boxes: any[], keys?: string[]) =>
  keys ? boxes.filter((b) => keys.includes(b.classKey)) : boxes;
export function contextBoxes(boxes: any[], selected: any[]) {
  const included = new Set(selected.map((b) => b.id));
  const parents = new Set(selected.map((b) => b.parentSystemId).filter(Boolean));
  return boxes.filter((b) => parents.has(b.id) && !included.has(b.id));
}
export function selectedCategories(version: string, keys?: string[]) {
  const all = categoriesFor(version);
  if (!keys) return all;
  const selected = all.filter((c) => keys.includes(c.key));
  need(selected.length === keys.length, "快照类别与标注版本不匹配", 409);
  return selected.map((c, id) => ({ ...c, sourceId: c.id, sourceCocoId: c.cocoId, id, cocoId: id + 1 }));
}
