import { confirmAction } from "./dialog";
import { api, json } from "./client";
export async function permanentDelete(
  kind: string,
  ids: string[],
  regionIds?: string[],
) {
  const plan = await api<{ token: string; summary: Record<string, number> }>(
    "/v2/deletions/preview",
    json({ kind, ids, ...(regionIds ? { regionIds } : {}) }),
  );
  const labels: Record<string, string> = {
    datasets: "个数据集", songs: "首歌曲", pages: "张谱页",
    regions: "个区域", measures: "个小节", events: "个事件",
    localizationRecords: "份定位记录", snapshots: "个导出快照",
  };
  const contents = Object.entries(labels)
    .filter(([key]) => plan.summary[key] > 0)
    .map(([key, label]) => `${plan.summary[key]} ${label}`)
    .join("、");
  if (!(await confirmAction(`删除${contents || "所选数据"}？相关文件和引用也将一并清理。`)))
    return false;
  await api(
    "/v2/deletions/execute",
    json({ token: plan.token, acknowledged: true }),
  );
  return true;
}
