import { need } from "./annotation.ts";
export const DELETION_LOCK = 79142609;
export async function deletionBarrier(c: any) {
  const exists = (
    await c.query("SELECT to_regclass('public.omr_deletion_jobs') t")
  ).rows[0].t;
  if (exists)
    need(
      !(
        await c.query(
          "SELECT 1 FROM omr_deletion_jobs WHERE status IN ('pending','failed') LIMIT 1",
        )
      ).rowCount,
      "永久删除清理未完成，请先重试清理任务",
      503,
    );
}
