import type { Box } from "./client";
export interface RegionIssue {
  boxId: string;
  parentId: string;
  message: string;
}
/** Same inclusive containment rule as server validation; never guesses a parent. */
export function regionIssues(
  boxes: readonly Pick<
    Box,
    "id" | "classKey" | "parentSystemId" | "x" | "y" | "width" | "height"
  >[],
): RegionIssue[] {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  return boxes.flatMap((b) => {
    if (!b.parentSystemId) return [];
    const p = byId.get(b.parentSystemId);
    const validParent = p && p.id !== b.id && p.classKey === "system";
    if (!validParent)
      return [
        {
          boxId: b.id,
          parentId: b.parentSystemId,
          message: "所属谱行不存在或不是完整谱行",
        },
      ];
    if (
      b.x < p.x ||
      b.y < p.y ||
      b.x + b.width > p.x + p.width ||
      b.y + b.height > p.y + p.height
    )
      return [
        {
          boxId: b.id,
          parentId: p.id,
          message: "区域超出所属谱行，请调整区域、谱行范围或所属关系",
        },
      ];
    return [];
  });
}
