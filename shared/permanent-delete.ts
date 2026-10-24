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
  const s = plan.summary;
  if (
    !(await confirmAction(
      `永久删除，无法恢复！\n将清理 ${s.datasets} 个数据集、${s.songs} 首歌曲、${s.pages} 张原图、${s.regions} 个区域、${s.measures || 0} 个小节、${s.events || 0} 个事件、${s.localizationRecords} 份定位记录、${s.snapshots} 个完整快照包，以及 ${s.objects} 个OSS对象。\n会级联删除跨数据集的引用及整个相关快照。确定继续？`,
    ))
  )
    return false;
  await api(
    "/v2/deletions/execute",
    json({ token: plan.token, acknowledged: true }),
  );
  return true;
}
