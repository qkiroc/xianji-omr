"use client";
import { cropApi, cropTaskName, type CropLabelTask } from "../../shared/crop-label-client";
import { TIME_DENOMINATORS } from "../../shared/time-signatures";
import { KeyDailyChart } from "./daily-chart";
import type { AnnotationTrend } from "../../shared/annotation-trend";
import { useEffect, useRef, useState } from "react";
import { Pagination, Progress, Tag, Alert } from "antd";
import { useSearchParams } from "next/navigation";
import { Button, Form, Input, Select, Table, TableHead, TableBody, TableRow, TableHeading, TableCell } from "../ui/antd";
import { ErrorToast } from "../ui/toast";
import { useNavigation } from "../navigation";
import { api, json, useQueryString, type PageResult } from "../../shared/client";
import { KEY_TONICS, type KeyDataset, type KeyRecord, type KeyWorkspace } from "../../shared/key-signatures";
type Result = PageResult<KeyRecord> & { dataset: KeyDataset; annotationTrend: AnnotationTrend };
const pretty = (tonic: string) => tonic.replace("b", "♭").replace("#", "♯");
export function KeyRecordList({ datasetId, task = "key-signatures" }: { datasetId: string; task?: CropLabelTask }) {
  const timeSignature = task === "time-signatures", taskName = cropTaskName(task);
  const { go } = useNavigation(), query = useSearchParams();
  const filters = query.toString(), base = "/" + task + "/datasets/" + datasetId;
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  useEffect(() => {
    const request = ++epoch.current;
    setLoading(true); setError(""); setData(null);
    cropApi<Result>(task, "/v2" + base + "/records?" + filters)
      .then((result) => { if (request === epoch.current) setData(result); })
      .catch((e) => { if (request === epoch.current) setError(e.message); })
      .finally(() => { if (request === epoch.current) setLoading(false); });
    return () => { epoch.current++; };
  }, [base, filters, revision]);
  const update = (values: Record<string,string | number | undefined>) =>
    go(base + "?" + useQueryString(new URLSearchParams(filters), values));
  const open = (id: string) => go(base + "/annotate?" + useQueryString(new URLSearchParams(filters), { recordId: id }));
  const dataset = data?.dataset;
  return <>
    <div className="section-head">
      <div>
        <Button type="button" onClick={() => go("/" + task + "/datasets")}>← 全部调号数据集</Button>
        <h1>{dataset?.name || taskName + "标注列表"}</h1>
        <p className="muted">{dataset?.description || "浏览标注记录，进入编辑器标注" + taskName + "内容。"}</p>
        {dataset?.source_name && <p className="small muted">关联切图：{dataset.source_name}</p>}
      </div>
      <div className="actions">
        <Button type="button" disabled={busy || loading || !dataset?.source_dataset_id} onClick={async () => {
          setBusy(true); setError(""); setNotice("");
          try {
            const result = await api<{imported:number}>("/v2" + base + "/sync", json({}));
            setNotice(`已导入 ${result.imported} 张新切图，已有标注已保留。`); setRevision((r) => r + 1);
          } catch(e) { setError(e instanceof Error ? e.message : "导入失败"); }
          finally { setBusy(false); }
        }}>{busy ? "处理中…" : "补充导入"}</Button>
        <a href={"/api/v2" + base + "/export"}>导出标注 JSON</a>
        <Button type="button" className="primary" disabled={busy || loading || !dataset || dataset.confirmed_count === dataset.sample_count}
          onClick={async () => {
            setBusy(true); setError("");
            try {
              const workspace = await cropApi<KeyWorkspace>(task, "/v2" + base + "/editor");
              if (workspace.record) open(workspace.record.id);
            } catch(e) { setError(e instanceof Error ? e.message : "打开失败"); }
            finally { setBusy(false); }
          }}>继续标注</Button>
      </div>
    </div>
    {dataset && <div className="key-list-summary">
      <span>全部切图 <b>{dataset.sample_count}</b></span>
      <span>待标注 <b>{dataset.sample_count - dataset.confirmed_count}</b></span>
      <span>已标注 <b>{dataset.confirmed_count}</b></span>
      <Progress percent={dataset.sample_count ? Math.round(dataset.confirmed_count / dataset.sample_count * 100) : 0} size="small" />
    </div>}
    {data && <KeyDailyChart name={taskName} trend={data.annotationTrend} onDaysChange={(trendDays) => update({trendDays})} />}
    <Form key={filters} className="filter-bar key-list-filters" onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      update({ ...Object.fromEntries((timeSignature ? ["search","status","numerator","denominator","split"] : ["search","status","tonic","kind","split"]).map((name) => [name,String(form.get(name) || "")])), page: 1 });
    }}>
      <Input name="search" aria-label="搜索调号切图" placeholder="搜索曲目 / 文件名" defaultValue={query.get("search") || ""} />
      <Select name="status" aria-label="标注状态" defaultValue={query.get("status") || ""}>
        <option value="">全部标注状态</option><option value="draft">待标注</option><option value="confirmed">已标注</option>
      </Select>
      {timeSignature ? <>
        <Select name="numerator" aria-label="拍号分子筛选" defaultValue={query.get("numerator") || ""}><option value="">全部分子</option>
          {Array.from({length:32},(_,i)=><option key={i+1} value={String(i+1)}>{i+1}</option>)}
        </Select>
        <Select name="denominator" aria-label="拍号分母筛选" defaultValue={query.get("denominator") || ""}><option value="">全部分母</option>
          {TIME_DENOMINATORS.map(d=><option key={d} value={String(d)}>{d}</option>)}
        </Select>
      </> : <>
      <Select name="tonic" aria-label="调号" defaultValue={query.get("tonic") || ""}>
        <option value="">全部调号</option>{KEY_TONICS.map((tonic) => <option key={tonic} value={tonic}>{pretty(tonic)}</option>)}
      </Select>
      <Select name="kind" aria-label="调号类型" defaultValue={query.get("kind") || ""}>
        <option value="">全部类型</option><option value="original">原调</option><option value="play">选调</option>
      </Select>
      </>}
      <Select name="split" aria-label="数据划分" defaultValue={query.get("split") || ""}>
        <option value="">全部划分</option><option>train</option><option>val</option><option>test</option>
      </Select>
      <Button>查询</Button><Button type="button" onClick={() => go(base)}>重置</Button>
    </Form>
    <ErrorToast>{error}</ErrorToast>
    {notice && <Alert type="success" showIcon title={notice} />}
    <div className="catalogue-summary"><span>{taskName}标注</span><span>{loading ? "加载中…" : `共 ${data?.total || 0} 张`}</span></div>
    <div className="table-scroll" aria-busy={loading}>
      <Table><TableHead><TableRow>
        <TableHeading>来源曲目 / 页码</TableHeading><TableHeading>{taskName}</TableHeading>
        {!timeSignature && <TableHeading>类型</TableHeading>}<TableHeading>划分</TableHeading><TableHeading>标注状态</TableHeading><TableHeading>操作</TableHeading>
      </TableRow></TableHead><TableBody>
        {data?.items.map((r) => <TableRow key={r.id} className="clickable" onClick={() => open(r.id)}>
          <TableCell><b>{r.source.songName}</b><p className="muted small">第 {r.source.pageOrder} 页 · {r.source.pageName}</p></TableCell>
          <TableCell><b>{r.tonic ? pretty(r.tonic) : "—"}</b></TableCell>
          {!timeSignature && <TableCell>{r.kind === "original" ? "原调" : r.kind === "play" ? "选调" : "—"}</TableCell>}
          <TableCell><Tag>{r.split}</Tag></TableCell>
          <TableCell><Tag color={r.status === "confirmed" ? "green" : "gold"}>{r.status === "confirmed" ? "已标注" : "待标注"}</Tag></TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}><Button type="button" onClick={() => open(r.id)}>{r.status === "confirmed" ? "查看 / 编辑" : "开始标注"}</Button></TableCell>
        </TableRow>)}
        {!data?.items.length && <TableRow><TableCell colSpan={timeSignature ? 5 : 6}>{loading ? "加载中…" : error ? "列表加载失败，请重试" : dataset?.sample_count ? "没有符合筛选条件的切图" : "暂无" + taskName + "切图，请先保存来源数据集中的对应框，再补充导入。"}</TableCell></TableRow>}
      </TableBody></Table>
    </div>
    {data && data.total > 0 && <Pagination className="pagination" current={data.page} pageSize={data.pageSize} total={data.total}
      showSizeChanger pageSizeOptions={[10,25,50,100]} onChange={(page, pageSize) => update({page:pageSize === data.pageSize ? page : 1,pageSize})} />}
  </>;
}