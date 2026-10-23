"use client";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  api,
  json,
  Song,
  Dataset,
  PageResult,
  useQueryString,
} from "../../shared/client";
import { useNavigation } from "../navigation";
interface Snapshot {
  id: string;
  status: string;
  stats: { sourcePages: number; uniqueImages: number };
  error: string | null;
}
export function SongList({ datasetId }: { datasetId: string }) {
  const requestId = useRef(0);
  const q = useSearchParams(),
    { go } = useNavigation(),
    [data, setData] = useState<PageResult<Song>>({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    }),
    [dataset, setDataset] = useState<Dataset | null>(null),
    [songs, setSongs] = useState<Song[]>([]),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Song | null | undefined>(undefined),
    [exports, setExports] = useState(false),
    [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [upload, setUpload] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [datasetEditing, setDatasetEditing] = useState(false);
  const base = "/datasets/" + datasetId,
    filters = q.toString(),
    page = Number(q.get("page") || 1),
    pageSize = Number(q.get("pageSize") || 50),
    deleted = q.get("deleted") === "deleted";
  const load = async () => {
    const epoch = ++requestId.current;
    try {
      setError("");
      const [result, ds, ss] = await Promise.all([
        api<PageResult<Song>>(
          "/v2/datasets/" + datasetId + "/song-records?" + filters,
        ),
        api<Dataset[]>("/v2/datasets"),
        api<Song[]>("/v2/datasets/" + datasetId + "/songs"),
      ]);
      if (epoch !== requestId.current) return;
      setData(result);
      setDataset(ds.find((x) => x.id === datasetId) || null);
      setSongs(ss);
      setSelected([]);
    } catch (e) {
      if (epoch === requestId.current)
        setError(e instanceof Error ? e.message : "加载失败");
    }
  };
  useEffect(() => {
    void load();
  }, [datasetId, filters]);
  const update = (values: Record<string, string | number | undefined>) =>
    go(base + "?" + useQueryString(new URLSearchParams(filters), values));
  const remove = async (items: Song[], restore = false) => {
    if (
      !restore &&
      !window.confirm(
        `删除${items.length}首歌曲入口？涉及${items.reduce((n, s) => n + s.page_count, 0)}页与${items.reduce((n, s) => n + s.box_count, 0)}框，可恢复。`,
      )
    )
      return;
    try {
      await api(
        "/v2/datasets/" +
          datasetId +
          "/songs/" +
          (restore ? "restore" : "delete"),
        json({
          items: items.map((s) => ({
            id: s.id,
            version: s.version,
            pageRevision: s.page_revision,
          })),
        }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  };
  const open = (s: Song, view = "original") =>
    go(
      s.first_page_id
        ? `${base}/songs/${s.id}/pages/${s.first_page_id}?${useQueryString(new URLSearchParams(filters), { view })}`
        : `${base}/songs/${s.id}?${filters}`,
    );
  const loadSnapshots = () =>
    api<Snapshot[]>("/v2/datasets/" + datasetId + "/snapshots")
      .then(setSnapshots)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!exports) return;
    const timer = setInterval(() => void loadSnapshots(), 1500);
    return () => clearInterval(timer);
  }, [exports, datasetId]);
  return (
    <>
      <div className="section-head">
        <div>
          <button onClick={() => go("/datasets")}>‹ 全部数据集</button>
          <h1>{dataset?.name || "歌曲列表"}</h1>
          <p className="muted">{dataset?.description}</p>
        </div>
        <div className="actions">
          <button onClick={() => setDatasetEditing(true)}>数据集信息</button>
          <button
            onClick={() => {
              setExports(true);
              void loadSnapshots();
            }}
          >
            冻结快照与导出
          </button>
          <button onClick={() => setEditing(null)}>＋ 新建歌曲</button>
          <button className="primary" onClick={() => setUpload(true)}>
            ＋ 上传原图
          </button>
        </div>
      </div>
      <form
        key={filters}
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          update({
            search: String(f.get("search") || ""),
            status: String(f.get("status") || ""),
            split: String(f.get("split") || ""),
            deleted: String(f.get("deleted") || ""),
            page: 1,
          });
        }}
      >
        <input
          name="search"
          aria-label="搜索歌曲"
          placeholder="搜索歌曲、文件名或来源"
          defaultValue={q.get("search") || ""}
        />
        <select
          name="status"
          aria-label="复核状态"
          defaultValue={q.get("status") || ""}
        >
          <option value="">全部复核状态</option>
          <option value="draft">草稿</option>
          <option value="confirmed">已确认</option>
          <option value="legacy">历史未归类</option>
        </select>
        <select name="split" defaultValue={q.get("split") || ""}>
          <option value="">全部集合</option>
          <option>train</option>
          <option>val</option>
          <option>test</option>
        </select>
        <select name="deleted" defaultValue={q.get("deleted") || "active"}>
          <option value="active">使用中</option>
          <option value="deleted">已删除</option>
        </select>
        <button>查询</button>
        <button type="button" onClick={() => go(base)}>
          重置
        </button>
      </form>
      <div className="actions">
        <span>已选{selected.length}首</span>
        <button
          disabled={!selected.length}
          onClick={() =>
            void remove(
              data.items.filter((s) => selected.includes(s.id)),
              deleted,
            )
          }
        >
          {deleted ? "恢复所选" : "删除所选"}
        </button>
      </div>
      <p className="error">{error}</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  aria-label="全选"
                  type="checkbox"
                  checked={
                    data.items.length > 0 &&
                    selected.length === data.items.length
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? data.items.map((s) => s.id) : [],
                    )
                  }
                />
              </th>
              <th>歌曲</th>
              <th>谱页数</th>
              <th>框数</th>
              <th>复核状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr
                className="clickable"
                key={s.id}
                onClick={() => !deleted && open(s)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={"选择 " + s.name}
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, s.id]
                          : selected.filter((id) => id !== s.id),
                      )
                    }
                  />
                </td>
                <td>{s.name}</td>
                <td>{s.page_count}</td>
                <td>{s.box_count}</td>
                <td>
                  <span
                    className={
                      "review-chip " +
                      (!deleted &&
                      s.confirmed_count === s.page_count &&
                      s.page_count > 0
                        ? "confirmed"
                        : "")
                    }
                  >
                    {deleted
                      ? "已删除"
                      : `${s.confirmed_count}/${s.page_count}页已确认`}
                  </span>
                </td>
                <td>{new Date(s.updated_at).toLocaleString()}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {!deleted && (
                    <>
                      <button onClick={() => open(s, "crops")}>查看裁片</button>{" "}
                      <button onClick={() => setEditing(s)}>
                        歌曲信息
                      </button>{" "}
                    </>
                  )}
                  <button onClick={() => void remove([s], deleted)}>
                    {deleted ? "恢复" : "删除"}
                  </button>
                </td>
              </tr>
            ))}
            {!data.items.length && (
              <tr>
                <td colSpan={7}>
                  <div className="table-empty">
                    暂无符合条件的歌曲，请调整筛选或上传原图。
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>
          共{data.total}首歌曲 · 第{page}页
        </span>
        <select
          aria-label="每页条数"
          value={pageSize}
          onChange={(e) => update({ pageSize: e.target.value, page: 1 })}
        >
          {[25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <button disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
          上一页
        </button>
        <button
          disabled={page * pageSize >= data.total}
          onClick={() => update({ page: page + 1 })}
        >
          下一页
        </button>
      </div>
      {datasetEditing && dataset && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api(
                  "/v2/datasets/" + datasetId,
                  json(
                    {
                      name: f.get("name"),
                      description: f.get("description"),
                      version: dataset.version,
                    },
                    "PUT",
                  ),
                );
                setDatasetEditing(false);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "保存失败");
              }
            }}
          >
            <h2>数据集信息</h2>
            <label>
              名称
              <input name="name" required defaultValue={dataset.name} />
            </label>
            <label>
              描述
              <textarea name="description" defaultValue={dataset.description} />
            </label>
            <p className="error">{error}</p>
            <button type="button" onClick={() => setDatasetEditing(false)}>
              取消
            </button>{" "}
            <button>保存</button>
          </form>
        </div>
      )}
      {editing !== undefined && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api(
                  editing
                    ? "/v2/songs/" + editing.id
                    : "/v2/datasets/" + datasetId + "/songs",
                  json(
                    {
                      name: f.get("name"),
                      songGroupKey: f.get("group"),
                      split: f.get("split"),
                      version: editing?.version,
                    },
                    editing ? "PUT" : "POST",
                  ),
                );
                setEditing(undefined);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "保存失败");
              }
            }}
          >
            <h2>歌曲信息</h2>
            <label>
              歌曲名称
              <input name="name" required defaultValue={editing?.name} />
            </label>
            <label>
              同曲分组键
              <input
                name="group"
                required
                defaultValue={editing?.song_group_key}
              />
            </label>
            <label>
              训练用途
              <select name="split" defaultValue={editing?.split || "train"}>
                <option>train</option>
                <option>val</option>
                <option>test</option>
              </select>
            </label>
            <p className="muted">同一曲组不得跨训练/验证/测试集合。</p>
            <div className="actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
              <button>保存</button>
            </div>
          </form>
        </div>
      )}
      {upload && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>上传原图</h2>
            <label>
              所属歌曲
              <select id="upload-song">
                {songs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <input
              aria-label="上传图片"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={!songs.length}
              onChange={async (e) => {
                const files = [...(e.target.files || [])],
                  songId = (
                    document.getElementById("upload-song") as HTMLSelectElement
                  ).value;
                try {
                  for (const f of files)
                    await api("/v2/songs/" + songId + "/pages", {
                      method: "POST",
                      headers: {
                        "Content-Type": f.type,
                        "X-File-Name": encodeURIComponent(f.name),
                      },
                      body: f,
                    });
                  setUpload(false);
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "上传失败");
                }
              }}
            />
            <p className="error">{error}</p>
            <button onClick={() => setUpload(false)}>关闭</button>
          </section>
        </div>
      )}
      {exports && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>冻结快照与导出</h2>
            <p>
              只导出确认页；历史快照不可变。超过200页用CLI选择一批，不拆分数据集。
            </p>
            <button
              onClick={async () => {
                try {
                  await api(
                    "/v2/datasets/" + datasetId + "/snapshots",
                    json({}),
                  );
                  await loadSnapshots();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "冻结失败");
                }
              }}
            >
              冻结全部确认数据
            </button>
            <p className="error">{error}</p>
            {snapshots.map((s) => (
              <div className="panel" key={s.id}>
                <b>
                  {s.status} · {s.stats.sourcePages}来源页 →{" "}
                  {s.stats.uniqueImages}训练图
                </b>
                {s.status === "ready" && (
                  <p>
                    <a href={"/api/v2/snapshots/" + s.id + "/detection"}>
                      整页检测包
                    </a>{" "}
                    ·{" "}
                    <a href={"/api/v2/snapshots/" + s.id + "/crops"}>
                      裁片与来源映射
                    </a>
                  </p>
                )}
                {s.error && <p className="error">{s.error}</p>}
                {s.status === "failed" && (
                  <button
                    onClick={async () => {
                      try {
                        await api("/v2/snapshots/" + s.id + "/retry", json({}));
                        await loadSnapshots();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "重试失败");
                      }
                    }}
                  >
                    重试导出
                  </button>
                )}
              </div>
            ))}
            <button onClick={() => setExports(false)}>关闭</button>
          </section>
        </div>
      )}
    </>
  );
}
