"use client";
import { ErrorToast } from "../ui/toast";
import { permanentDelete } from "../../shared/permanent-delete";
import { Icon } from "../ui/icon";
import { useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { api, json, Dataset } from "../../shared/client";
import type { LocDataset } from "../../shared/localization";
import { useNavigation, LegacyHash } from "../navigation";
export function DatasetList({
  localization = false,
}: {
  localization?: boolean;
}) {
  const epoch = useRef(0);
  const q = useSearchParams();
  const { go } = useNavigation(),
    [items, setItems] = useState<(Dataset | LocDataset)[]>([]),
    [error, setError] = useState(""),
    [create, setCreate] = useState(false),
    [loading, setLoading] = useState(true);
  const deleted = q.get("deleted") === "deleted";
  const base = localization ? "/localization/datasets" : "/datasets";
  const load = () => {
    const request = ++epoch.current;
    setError("");
    setLoading(true);
    return api<(Dataset | LocDataset)[]>(
      "/v2" + base + (!localization && deleted ? "?deleted=deleted" : ""),
    )
      .then((value) => {
        if (request === epoch.current) setItems(value);
      })
      .catch((e) => {
        if (request === epoch.current) setError(e.message);
      })
      .finally(() => {
        if (request === epoch.current) setLoading(false);
      });
  };
  useEffect(() => {
    void load();
  }, [base, deleted]);
  return (
    <>
      <LegacyHash />
      <div className="section-head">
        <div>
          <h1>{localization ? "小节与事件定位" : "切图标注"}</h1>
          <p className="muted">
            {localization
              ? "独立定位标签 · 引用已有原图 · 只确认几何，不代表音乐内容真值"
              : "按数据集和歌曲管理原图、区域与元信息"}
          </p>
        </div>
        <div className="actions">
          {!localization && (
            <select
              aria-label="数据集状态"
              value={String(deleted)}
              onChange={(e) =>
                go(base + (e.target.value === "true" ? "?deleted=deleted" : ""))
              }
            >
              <option value="false">使用中</option>
              <option value="true">历史回收数据</option>
            </select>
          )}
          <button className="primary" onClick={() => setCreate(true)}>
            ＋ 新建数据集
          </button>
        </div>
      </div>
      <ErrorToast>{error}</ErrorToast>
      <div className="catalogue-summary">
        <span>{deleted ? "历史待清理" : "全部数据集"}</span>
        <span>{loading ? "加载中…" : `${items.length} 个数据集`}</span>
      </div>
      <div className="cards" aria-busy={loading}>
        {items.map((d) => (
          <article key={d.id} className="card">
            <button
              className="card-open"
              style={{
                border: 0,
                padding: 0,
                textAlign: "left",
                background: "none",
              }}
              disabled={deleted}
              onClick={() => go(base + "/" + d.id)}
            >
              <div className="dataset-icon">
                <Icon name="folder" />
              </div>
              <h2>{d.name}</h2>
              <p className="muted">{d.description || "暂无描述"}</p>
              <div className="stats">
                <span>
                  <strong>
                    {"record_count" in d
                      ? d.record_count
                      : "page_count" in d
                        ? d.page_count
                        : 0}
                  </strong>
                  {localization ? "语料记录" : "图片"}
                </span>
                <span>
                  <strong>{d.confirmed_count}</strong>已确认
                </span>
              </div>
              <p className="small muted">
                更新于
                {new Date(
                  "content_updated_at" in d
                    ? String(d.content_updated_at)
                    : d.updated_at,
                ).toLocaleString()}
              </p>
            </button>
            <button
              className="card-delete"
              onClick={async () => {
                try {
                  if (
                    await permanentDelete(
                      localization ? "locDataset" : "dataset",
                      [d.id],
                    )
                  )
                    await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "删除失败");
                }
              }}
            >
              永久删除
            </button>
          </article>
        ))}
      </div>
      {!loading && !items.length && !error && (
        <div className="empty-state">
          <Icon name="folder" />
          <h2>{deleted ? "没有历史待清理数据" : "还没有数据集"}</h2>
          <p>
            {deleted
              ? "仅显示升级前遗留的回收数据，新删除不会进入此处。"
              : "新建数据集，开始整理歌曲与标注数据。"}
          </p>
          {!deleted && (
            <button className="primary" onClick={() => setCreate(true)}>
              ＋ 新建数据集
            </button>
          )}
        </div>
      )}
      {create && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const d = await api<Dataset>(
                  "/v2" + base,
                  json({
                    name: f.get("name"),
                    description: f.get("description"),
                  }),
                );
                setCreate(false);
                go(base + "/" + d.id);
              } catch (e) {
                setError(e instanceof Error ? e.message : "新建失败");
              }
            }}
          >
            <h2>新建数据集</h2>
            <label>
              名称
              <input name="name" required maxLength={200} />
            </label>
            <label>
              描述
              <textarea name="description" />
            </label>
            <div className="actions">
              <button type="button" onClick={() => setCreate(false)}>
                取消
              </button>
              <button className="primary">创建</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
