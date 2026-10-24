"use client";
import {
  Button,
  Form,
  Input,
  Select,
  Table,
  TableHead,
  TableRow,
  TableHeading,
  TableBody,
  TableCell,
  Dialog,
  Textarea,
} from "../ui/antd";
import { Button as AntButton, Dropdown, Input as AntInput, Table as AntTable, Tag } from "antd";
import { pageEditorTarget, reviewQueue } from "../../shared/editor-navigation";
import { ErrorToast } from "../ui/toast";
import { permanentDelete } from "../../shared/permanent-delete";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  api,
  json,
  Song,
  PageImage,
  Dataset,
  PageResult,
  useQueryString,
} from "../../shared/client";
import { useNavigation } from "../navigation";
interface PageRow extends PageImage {
  songName: string;
  boxCount: number;
}
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
    [data, setData] = useState<PageResult<PageRow>>({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    }),
    [dataset, setDataset] = useState<Dataset | null>(null),
    [songs, setSongs] = useState<Song[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [removing, setRemoving] = useState(false),
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
      setLoading(true);
      setError("");
      const [result, ds, ss] = await Promise.all([
        api<PageResult<PageRow>>(
          "/v2/datasets/" + datasetId + "/pages?" + filters,
        ),
        api<Dataset[]>("/v2/datasets"),
        api<Song[]>("/v2/datasets/" + datasetId + "/songs"),
      ]);
      if (epoch !== requestId.current) return;
      if (!result.items.length && result.total && result.page > 1) {
        update({ page: Math.ceil(result.total / result.pageSize) });
        return;
      }
      setData(result);
      setDataset(ds.find((x) => x.id === datasetId) || null);
      setSongs(ss);
      setSelected([]);
    } catch (e) {
      if (epoch === requestId.current)
        setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (epoch === requestId.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => { requestId.current++; };
  }, [datasetId, filters]);
  const update = (values: Record<string, string | number | undefined>) =>
    go(base + "?" + useQueryString(new URLSearchParams(filters), values));
  const remove = async (items: PageRow[], _restore = false) => {
    if (removing || !items.length) return;
    setRemoving(true);
    try {
      if (
        await permanentDelete(
          "page",
          items.map((s) => s.id),
        )
      )
        await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setRemoving(false);
    }
  };
  const open = (s: PageRow, view = "original") =>
    go(pageEditorTarget(
      datasetId, s,
      new URLSearchParams(useQueryString(new URLSearchParams(filters), { view })),
      reviewQueue(new URLSearchParams(filters), s),
    ));
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
      <div className="section-head page-list-heading">
        <div>
          <Button onClick={() => go("/datasets")}>‹ 全部数据集</Button>
          <h1>{dataset?.name || "谱页列表"}</h1>
          <p className="muted">{dataset?.description || "选择一张谱页开始标注或复核"}</p>
        </div>
        <div className="actions">
          <Dropdown menu={{ items: [
            { key: "info", label: "数据集信息", onClick: () => setDatasetEditing(true) },
            { key: "song", label: "新建歌曲", onClick: () => setEditing(null) },
            { key: "export", label: "快照与导出", onClick: () => {
              setExports(true);
              void loadSnapshots();
            } },
          ] }} trigger={["click"]}>
            <AntButton>管理数据集 ▾</AntButton>
          </Dropdown>
          <Button className="primary" onClick={() => setUpload(true)}>上传原图</Button>
        </div>
      </div>
      <div className="page-list-panel">
        <div className="page-list-filters">
          <AntInput.Search
            key={q.get("search") || ""}
            aria-label="搜索歌曲"
            placeholder="搜索歌曲、文件名或来源"
            defaultValue={q.get("search") || ""}
            allowClear
            onSearch={(search) => update({ search, page: 1 })}
          />
          <Select
            aria-label="复核状态"
            value={q.get("status") || ""}
            onChange={(e) => update({ status: e.target.value, page: 1 })}
          >
            <option value="">全部复核状态</option>
            <option value="draft">草稿</option>
            <option value="ai_reviewed">AI 已复核</option>
            <option value="confirmed">已确认</option>
            <option value="legacy">历史未归类</option>
          </Select>
          <Select
            aria-label="训练集合"
            value={q.get("split") || ""}
            onChange={(e) => update({ split: e.target.value, page: 1 })}
          >
            <option value="">全部集合</option>
            <option value="train">训练集</option>
            <option value="val">验证集</option>
            <option value="test">测试集</option>
          </Select>
          <AntButton type="text" onClick={() => go(base)}>重置筛选</AntButton>
          <span className="spacer" />
          <span className="muted small">共 {data.total} 张谱页</span>
        </div>
        {!!selected.length && (
          <div className="page-list-selection">
            <span>已选 {selected.length} 张谱页</span>
            <AntButton size="small" onClick={() => setSelected([])}>取消选择</AntButton>
            <AntButton size="small" danger loading={removing}
              onClick={() => void remove(data.items.filter((p) => selected.includes(p.id)))}>
              删除所选
            </AntButton>
          </div>
        )}
        <ErrorToast>{error}</ErrorToast>
        <AntTable<PageRow>
          rowKey="id"
          loading={loading}
          size="middle"
          scroll={{ x: 760 }}
          dataSource={data.items}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys.map(String)),
          }}
          onRow={(row) => ({
            className: deleted ? "" : "clickable",
            onClick: () => !deleted && open(row),
          })}
          columns={[
            {
              title: "序号",
              key: "pageOrder",
              width: 96,
              render: (_, row) => <span className="page-order">第 {row.pageOrder} 页</span>,
            },
            {
              title: "归属歌曲",
              key: "songName",
              render: (_, row) => <div className="page-song-cell">
                <span>{row.songName}</span>
                <span className="muted small">{row.name}</span>
              </div>,
            },
            { title: "区域", dataIndex: "boxCount", width: 80 },
            {
              title: "复核状态",
              key: "status",
              width: 130,
              render: (_, row) => <Tag color={
                row.status === "confirmed" ? "green" :
                row.status === "ai_reviewed" ? "purple" : "default"
              }>{
                deleted ? "已删除" : row.annotationFormat === "legacy" ? "历史未归类" :
                row.status === "confirmed" ? "已确认" :
                row.status === "ai_reviewed" ? "AI 已复核" : "草稿"
              }</Tag>,
            },
            {
              title: "操作",
              key: "actions",
              width: 236,
              onCell: () => ({ onClick: (e) => e.stopPropagation() }),
              render: (_, row) => <div className="actions">
                {!deleted && <AntButton type="link" size="small" onClick={() => open(row)}>
                  {row.status === "confirmed" ? "查看" : "标注 / 复核"}
                </AntButton>}
                {!deleted && <AntButton type="text" size="small" onClick={() => open(row, "crops")}>裁片</AntButton>}
                <Dropdown trigger={["click"]} menu={{ items: [
                  ...(!deleted ? [{ key: "song", label: "歌曲信息", onClick: () =>
                    setEditing(songs.find((song) => song.id === row.songId)) }] : []),
                  { key: "delete", label: "删除谱页", danger: true,
                    disabled: removing, onClick: () => void remove([row]) },
                ] }}>
                  <AntButton type="text" size="small" aria-label={"更多操作 " + row.name}>•••</AntButton>
                </Dropdown>
              </div>,
            },
          ]}
          locale={{ emptyText: loading ? "加载中…" : "暂无符合条件的谱页，请调整筛选或上传原图。" }}
          pagination={{
            current: page,
            pageSize,
            total: data.total,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100],
            showTotal: (n) => `共 ${n} 张谱页`,
            onChange: (current, size) => update({ page: current, pageSize: size }),
          }}
        />
      </div>
      {datasetEditing && dataset && (
        <Dialog>
          <Form
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
              <Input name="name" required defaultValue={dataset.name} />
            </label>
            <label>
              描述
              <Textarea name="description" defaultValue={dataset.description} />
            </label>
            <ErrorToast>{error}</ErrorToast>
            <Button type="button" onClick={() => setDatasetEditing(false)}>
              取消
            </Button>{" "}
            <Button>保存</Button>
          </Form>
        </Dialog>
      )}
      {editing !== undefined && (
        <Dialog>
          <Form
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
              <Input name="name" required defaultValue={editing?.name} />
            </label>
            <label>
              同曲分组键
              <Input
                name="group"
                required
                defaultValue={editing?.song_group_key}
              />
            </label>
            <label>
              训练用途
              <Select name="split" defaultValue={editing?.split || "train"}>
                <option>train</option>
                <option>val</option>
                <option>test</option>
              </Select>
            </label>
            <p className="muted">同一曲组不得跨训练/验证/测试集合。</p>
            <div className="actions">
              <Button type="button" onClick={() => setEditing(undefined)}>
                取消
              </Button>
              <Button>保存</Button>
            </div>
          </Form>
        </Dialog>
      )}
      {upload && (
        <Dialog>
          <section className="modal">
            <h2>上传原图</h2>
            <label>
              所属歌曲
              <Select id="upload-song">
                {songs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
            <Input
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
            <ErrorToast>{error}</ErrorToast>
            <Button onClick={() => setUpload(false)}>关闭</Button>
          </section>
        </Dialog>
      )}
      {exports && (
        <Dialog>
          <section className="modal">
            <h2>冻结快照与导出</h2>
            <p>
              只导出确认页；历史快照不可变。超过200页用CLI选择一批，不拆分数据集。
            </p>
            <Button
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
            </Button>
            <ErrorToast>{error}</ErrorToast>
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
                {s.error && <ErrorToast>{s.error}</ErrorToast>}
                <Button
                  onClick={async () => {
                    try {
                      if (await permanentDelete("snapshot", [s.id]))
                        await loadSnapshots();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "删除失败");
                    }
                  }}
                >
                  删除快照
                </Button>
                {s.status === "failed" && (
                  <Button
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
                  </Button>
                )}
              </div>
            ))}
            <Button onClick={() => setExports(false)}>关闭</Button>
          </section>
        </Dialog>
      )}
    </>
  );
}
