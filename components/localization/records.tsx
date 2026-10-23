"use client";
import { ErrorToast } from "../ui/toast";
import { clientId } from "../../shared/client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  api,
  json,
  PageResult,
  useQueryString,
  LayoutDocument,
  Song,
} from "../../shared/client";
import type { LocalizationRecord, LocDataset } from "../../shared/localization";
import { useNavigation } from "../navigation";
export function LocalizationRecords({ datasetId }: { datasetId: string }) {
  const q = useSearchParams(),
    { go } = useNavigation(),
    [data, setData] = useState<PageResult<LocalizationRecord>>({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    }),
    [error, setError] = useState(""),
    [title, setTitle] = useState("定位数据集"),
    [reference, setReference] = useState(false),
    [importing, setImporting] = useState(false),
    [busy, setBusy] = useState(false),
    [showExports, setShowExports] = useState(false),
    [snapshots, setSnapshots] = useState<
      { id: string; fingerprint: string; created_at: string }[]
    >([]);
  const base = "/localization/datasets/" + datasetId;
  useEffect(() => {
    let active = true;
    setError("");
    api<PageResult<LocalizationRecord>>("/v2" + base + "/records?" + q)
      .then((data) => {
        if (active) setData(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    api<LocDataset[]>("/v2/localization/datasets")
      .then((ds) => {
        if (active)
          setTitle(ds.find((d) => d.id === datasetId)?.name || "定位数据集");
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [datasetId, q]);
  const update = (values: Record<string, string | number | undefined>) =>
    go(base + "?" + useQueryString(new URLSearchParams(q), values));
  return (
    <>
      <div className="section-head">
        <div>
          <button onClick={() => go("/localization/datasets")}>
            ‹ 定位数据集
          </button>
          <h1>{title}</h1>
          <p className="muted">
            独立几何标签 · 仅引用已有原图 · 历史AI状态不是人工确认
          </p>
        </div>
        <div className="actions">
          <button onClick={() => setReference(true)}>引用原图</button>
          <button onClick={() => setImporting(true)}>导入历史语料</button>
          <button
            onClick={async () => {
              setShowExports(true);
              try {
                setSnapshots(await api("/v2" + base + "/snapshots"));
              } catch (e) {
                setError(e instanceof Error ? e.message : "读取快照失败");
              }
            }}
          >
            冻结快照与导出
          </button>
        </div>
      </div>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          update({
            search: String(f.get("search") || ""),
            source: String(f.get("source") || ""),
            status: String(f.get("status") || ""),
            split: String(f.get("split") || ""),
            page: 1,
          });
        }}
      >
        <input
          name="search"
          aria-label="搜索定位语料"
          placeholder="歌曲 / 原语料ID"
          defaultValue={q.get("search") || ""}
        />
        <input
          name="source"
          placeholder="来源method"
          defaultValue={q.get("source") || ""}
        />
        <select name="status" defaultValue={q.get("status") || ""}>
          <option value="">全部状态</option>
          <option value="draft">待复核</option>
          <option value="confirmed">几何已确认</option>
        </select>
        <select name="split" defaultValue={q.get("split") || ""}>
          <option value="">全部split</option>
          <option>train</option>
          <option>val</option>
          <option>test</option>
        </select>
        <button>查询</button>
      </form>
      <ErrorToast>{error}</ErrorToast>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>歌曲 / 语料</th>
              <th>来源ID / revision</th>
              <th>曲组</th>
              <th>split</th>
              <th>几何状态</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr
                className="clickable"
                key={r.id}
                onClick={() => go(base + "/records/" + r.id + "?" + q)}
              >
                <td>{r.title}</td>
                <td>
                  {r.corpus_id} · r{r.corpus_revision}
                </td>
                <td>{r.group_key}</td>
                <td>{r.split}</td>
                <td>{r.status === "confirmed" ? "几何已确认" : "待复核"}</td>
                <td>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>共{data.total}份来源语料</span>
        <button
          disabled={data.page <= 1}
          onClick={() => update({ page: data.page - 1 })}
        >
          上一页
        </button>
        <button
          disabled={data.page * data.pageSize >= data.total}
          onClick={() => update({ page: data.page + 1 })}
        >
          下一页
        </button>
      </div>
      {showExports && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>定位快照与导出</h2>
            <p>
              只冻结人工确认的几何，不代表音乐内容真值；历史修订不会自动合并成金标。
            </p>
            <button
              onClick={async () => {
                try {
                  await api("/v2" + base + "/snapshots", json({}));
                  setSnapshots(await api("/v2" + base + "/snapshots"));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "冻结失败");
                }
              }}
            >
              冻结全部已确认定位
            </button>
            <p className="small muted">
              上限100份/3000小节，更多可用CLI recordIds分批。
            </p>
            <ErrorToast>{error}</ErrorToast>
            {snapshots.map((s) => (
              <article className="panel" key={s.id}>
                <p>
                  {new Date(s.created_at).toLocaleString()} · {s.id}
                </p>
                <a href={"/api/v2/localization/snapshots/" + s.id + "/native"}>
                  原生JSON与原附件
                </a>{" "}
                ·{" "}
                <a href={"/api/v2/localization/snapshots/" + s.id + "/crops"}>
                  裁片与来源映射ZIP
                </a>
              </article>
            ))}
            <button onClick={() => setShowExports(false)}>关闭</button>
          </section>
        </div>
      )}
      {(reference || importing) && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                let value: unknown;
                if (reference) {
                  const sourceId = String(f.get("page")),
                    page = await api<LayoutDocument>("/v2/pages/" + sourceId),
                    ss = await api<Song[]>(
                      "/v2/datasets/" + page.image.datasetId + "/songs",
                    ),
                    song = ss.find((s) => s.id === page.image.songId)!;
                  const image = page.image as typeof page.image & {
                    checksum: string;
                    originalWidth: number;
                    originalHeight: number;
                  };
                  value = {
                    sourcePageMap: { page: sourceId },
                    corpus: {
                      version: "omr-event-corpus-v1",
                      revision: 1,
                      source: {
                        sample_id: "manual-" + clientId(),
                        revision: 1,
                        title: String(f.get("title") || song.name),
                        group_id: song.song_group_key,
                        pages: [
                          {
                            asset_id: "page",
                            width: image.originalWidth,
                            height: image.originalHeight,
                            sha256: image.checksum,
                            coordinate_mapping: [
                              [1, 0, 0],
                              [0, 1, 0],
                              [0, 0, 1],
                            ],
                          },
                        ],
                      },
                      split: song.split,
                      provenance: { method: "manual-geometry" },
                      measures: [],
                      relations: [],
                      texts: [],
                    },
                  };
                } else value = JSON.parse(String(f.get("payload")));
                const result = await api<{ record: LocalizationRecord }>(
                  "/v2" + base + "/import",
                  json(value),
                );
                go(base + "/records/" + result.record.id);
              } catch (e) {
                setError(e instanceof Error ? e.message : "导入失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>{reference ? "引用已有原图" : "导入原语料和页ID映射"}</h2>
            {reference ? (
              <>
                <label>
                  平台原图UUID
                  <input name="page" required />
                </label>
                <label>
                  歌曲/样本标题
                  <input name="title" />
                </label>
                <p>
                  不会重复上传图片，曲组和split继承原图所属歌曲。新建记录没有预标注几何。
                </p>
              </>
            ) : (
              <>
                <label>
                  完整JSON（corpus + sourcePageMap）
                  <textarea name="payload" required rows={12} />
                </label>
                <p>
                  未知字段和音乐内容保留为只读original；历史accepted不会自动人工确认。大批数据请使用CLI
                  stdin导入。
                </p>
              </>
            )}
            <ErrorToast>{error}</ErrorToast>
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  setReference(false);
                  setImporting(false);
                }}
              >
                取消
              </button>
              <button disabled={busy}>
                {busy ? "处理中…" : "导入为待复核"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
