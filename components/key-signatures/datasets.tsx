"use client";
import { cropTaskName, type CropLabelTask } from "../../shared/crop-label-client";
import { useEffect, useState } from "react";
import { Card, Progress } from "antd";
import { Button, Dialog, Form, Input, Select, Textarea } from "../ui/antd";
import { ErrorToast } from "../ui/toast";
import { useNavigation } from "../navigation";
import { api, json, type Dataset } from "../../shared/client";
import type { KeyDataset } from "../../shared/key-signatures";

export function KeyDatasetList({task = "key-signatures"}: {task?: CropLabelTask}) {
  const taskName = cropTaskName(task), base = "/" + task + "/datasets";
  const { go } = useNavigation();
  const [items, setItems] = useState<KeyDataset[]>([]);
  const [sources, setSources] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setItems([]); setError("");
    Promise.all([api<KeyDataset[]>("/v2" + base), api<Dataset[]>("/v2/datasets")])
      .then(([datasets, sourceDatasets]) => { if (active) { setItems(datasets); setSources(sourceDatasets); } })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base]);
  return <>
    <div className="section-head">
      <div><h1>{taskName}标注</h1><p className="muted">从切图数据集提取{taskName}图片，标注{taskName}内容。</p></div>
      <Button className="primary" disabled={loading || !!error} onClick={() => { setFormError(""); setCreating(true); }}>＋ 新建{taskName}数据集</Button>
    </div>
    <ErrorToast>{error}</ErrorToast>
    <div className="catalogue-summary"><span>全部{taskName}数据集</span><span>{loading ? "加载中…" : `${items.length} 个数据集`}</span></div>
    <div className="cards" aria-busy={loading}>
      {items.map((d) => <Card key={d.id} className="card">
        <button type="button" className="key-dataset-open" onClick={() => go(base + "/" + d.id)}>
          <span className="key-dataset-mark">{task === "time-signatures" ? "4/4" : "♯ ♭"}</span>
          <h2>{d.name}</h2><p className="muted">{d.description || taskName + "识别训练数据"}</p>
          <p className="small muted">关联切图：{d.source_name || "来源数据集已删除"}</p>
          <Progress percent={d.sample_count ? Math.round(d.confirmed_count / d.sample_count * 100) : 0} size="small" />
          <p>{d.confirmed_count} / {d.sample_count} 已标注<span className="key-card-pending">{d.sample_count - d.confirmed_count} 待标注</span></p>
        </button>
      </Card>)}
    </div>
    {!loading && !items.length && !error && <div className="empty-state"><h2>还没有{taskName}数据集</h2><p>关联已有切图数据集，自动生成待标注的{taskName}图片。</p><Button onClick={() => setCreating(true)}>新建{taskName}数据集</Button></div>}
    {creating && <Dialog><Form className="modal" onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      const form = new FormData(event.currentTarget);
      setBusy(true); setFormError("");
      try {
        const d = await api<KeyDataset>("/v2" + base, json({
          name: form.get("name"), description: form.get("description"), sourceDatasetId: form.get("sourceDatasetId"),
        }));
        setCreating(false); go(base + "/" + d.id);
      } catch (e) { setFormError(e instanceof Error ? e.message : "创建失败"); }
      finally { setBusy(false); }
    }}>
      <h2>新建{taskName}数据集</h2>
      <label>名称<Input name="name" required maxLength={200} autoFocus disabled={busy} /></label>
      <label>关联切图数据集<Select name="sourceDatasetId" defaultValue="" disabled={busy}>
        <option value="" disabled>请选择切图数据集</option>
        {sources.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select></label>
      <p className="muted small">提取已保存的{taskName}框，包括待复核切图。内容需在此重新人工标注。后续可补充导入新切图。</p>
      {!sources.length && <p className="muted">请先创建切图数据集并保存{taskName}框。</p>}
      <label>描述<Textarea name="description" maxLength={2000} disabled={busy} /></label>
      <ErrorToast>{formError}</ErrorToast>
      <div className="actions"><Button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</Button><Button className="primary" disabled={busy || !sources.length}>{busy ? "正在提取" + taskName + "切图…" : "创建并提取切图"}</Button></div>
    </Form></Dialog>}
  </>;
}