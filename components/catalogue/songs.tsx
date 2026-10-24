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
import { Pagination, Tag } from "antd";
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
        api<PageResult<PageRow>>(
          "/v2/datasets/" + datasetId + "/pages?" + filters,
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
  const remove = async (items: PageRow[], _restore = false) => {
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
    }
  };
  const open = (s: PageRow, view = "original") =>
    go(
      `${base}/songs/${s.songId}/pages/${s.id}?${useQueryString(new URLSearchParams(filters), { view })}`,
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
          <Button onClick={() => go("/datasets")}>‹ 全部数据集</Button>
          <h1>{dataset?.name || "谱页列表"}</h1>
          <p className="muted">{dataset?.description}</p>
        </div>
        <div className="actions">
          <Button onClick={() => setDatasetEditing(true)}>数据集信息</Button>
          <Button
            onClick={() => {
              setExports(true);
              void loadSnapshots();
            }}
          >
            冻结快照与导出
          </Button>
          <Button onClick={() => setEditing(null)}>＋ 新建歌曲</Button>
          <Button className="primary" onClick={() => setUpload(true)}>
            ＋ 上传原图
          </Button>
        </div>
      </div>
      <Form
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
        <Input
          name="search"
          aria-label="搜索歌曲"
          placeholder="搜索歌曲、文件名或来源"
          defaultValue={q.get("search") || ""}
        />
        <Select
          name="status"
          aria-label="复核状态"
          defaultValue={q.get("status") || ""}
        >
          <option value="">全部复核状态</option>
          <option value="draft">草稿</option>
          <option value="ai_reviewed">AI 已复核</option>
          <option value="confirmed">已确认</option>
          <option value="legacy">历史未归类</option>
        </Select>
        <Select name="split" defaultValue={q.get("split") || ""}>
          <option value="">全部集合</option>
          <option>train</option>
          <option>val</option>
          <option>test</option>
        </Select>
        <Select name="deleted" defaultValue={q.get("deleted") || "active"}>
          <option value="active">使用中</option>
          <option value="deleted">历史回收数据</option>
        </Select>
        <Button>查询</Button>
        <Button type="button" onClick={() => go(base)}>
          重置
        </Button>
      </Form>
      <div className="actions">
        <span>已选{selected.length}页</span>
        <Button
          disabled={!selected.length}
          onClick={() =>
            void remove(
              data.items.filter((s) => selected.includes(s.id)),
              deleted,
            )
          }
        >
          永久删除所选
        </Button>
      </div>
      <ErrorToast>{error}</ErrorToast>
      <div className="table-scroll">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeading>
                <Input
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
              </TableHeading>
              <TableHeading>序号</TableHeading>
              <TableHeading>归属歌曲</TableHeading>
              <TableHeading>框数</TableHeading>
              <TableHeading>复核状态</TableHeading>
              <TableHeading>操作</TableHeading>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.items.map((s, rowIndex) => (
              <TableRow
                className="clickable"
                key={s.id}
                onClick={() => !deleted && open(s)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Input
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
                </TableCell>
                <TableCell>{(page - 1) * pageSize + rowIndex + 1}</TableCell>
                <TableCell>{s.songName}</TableCell>
                <TableCell>{s.boxCount}</TableCell>
                <TableCell>
                  <Tag
                    className={
                      "review-chip " +
                      (!deleted && s.status === "confirmed"
                        ? "confirmed"
                        : s.status === "ai_reviewed"
                          ? "ai-reviewed"
                          : "")
                    }
                  >
                    {deleted
                      ? "已删除"
                      : s.status === "confirmed"
                        ? "已确认"
                        : s.status === "ai_reviewed"
                          ? "AI 已复核"
                          : "待标记"}
                  </Tag>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {!deleted && (
                    <>
                      <Button onClick={() => open(s, "crops")}>查看裁片</Button>{" "}
                      <Button
                        onClick={() =>
                          setEditing(songs.find((song) => song.id === s.songId))
                        }
                      >
                        歌曲信息
                      </Button>{" "}
                    </>
                  )}
                  <Button onClick={() => void remove([s], deleted)}>
                    永久删除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!data.items.length && (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="table-empty">
                    暂无符合条件的谱页，请调整筛选或上传原图。
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        className="pagination"
        current={page}
        pageSize={pageSize}
        total={data.total}
        showSizeChanger
        pageSizeOptions={[25, 50, 100]}
        showTotal={(n) => `共 ${n} 张谱页`}
        onChange={(current, size) => update({ page: current, pageSize: size })}
      />
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
                  永久删除快照
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
