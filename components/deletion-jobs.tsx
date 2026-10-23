"use client";
import { useEffect, useState } from "react";
import { api, json } from "../shared/client";
import { ErrorToast } from "./ui/toast";
export function DeletionJobs() {
  const [jobs, setJobs] = useState<{ id: string; status: string }[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<typeof jobs>("/v2/deletions")
      .then(setJobs)
      .catch(() => {});
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <ErrorToast>{error}</ErrorToast>
      {!!jobs.length && (
        <button className="deletion-jobs-button" onClick={() => setOpen(true)}>
          永久清理待完成 · {jobs.length}
        </button>
      )}
      {open && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>永久删除清理任务</h2>
            <p>
              数据库与OSS全部清理完成才会显示删除成功。存在待完成任务时暂停数据操作；可安全重试，不会重复删除其他数据。
            </p>
            {jobs.map((j) => (
              <div className="panel" key={j.id}>
                <p>
                  {j.id} · {j.status === "failed" ? "待重试" : "正在清理"}
                </p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api("/v2/deletions/" + j.id + "/retry", json({}));
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "清理失败");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  重试清理
                </button>
              </div>
            ))}
            {!jobs.length && <p>清理已完成，请刷新列表。</p>}
            <button onClick={() => setOpen(false)}>关闭</button>
          </section>
        </div>
      )}
    </>
  );
}
