"use client";
import { useEffect, useState } from "react";
import { Button, Card, Empty, Form, Input, Modal, Select, Space, Tag } from "antd";
import { api, json, type Dataset } from "../../shared/client";
import type { LocDataset } from "../../shared/localization";
import { useNavigation } from "../navigation";
import { ErrorToast } from "../ui/toast";
import { permanentDelete } from "../../shared/permanent-delete";

export function LocalizationDatasets() {
  const { go } = useNavigation();
  const [items,setItems] = useState<LocDataset[]>([]), [sources,setSources] = useState<Dataset[]>([]);
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [form] = Form.useForm();
  const load = async () => {
    try { const [ds,src] = await Promise.all([api<LocDataset[]>("/v2/localization/datasets"),api<Dataset[]>("/v2/datasets")]); setItems(ds);setSources(src); }
    catch(e) {setError((e as Error).message);}
  };
  useEffect(() => {void load();},[]);
  return <>
    <div className="section-head"><div><h1>小节与音符事件</h1><p className="muted">从已确认的切图生成谱行样本，只标注小节与事件区域，具体内容留给后续模型识别。</p></div><Button type="primary" onClick={() => setOpen(true)}>新建数据集</Button></div>
    <ErrorToast>{error}</ErrorToast>
    <div className="cards">{items.map(d => <Card key={d.id} title={d.name} extra={<Tag>小节与音符事件</Tag>}>
      <p>{d.description || "暂无描述"}</p><p className="muted">来源：{d.source_name || "未关联切图数据集"}</p><p>共 {d.record_count || 0} 页 · 已确认 {d.confirmed_count || 0} 页</p>
      <Space><Button type="primary" onClick={() => go("/localization/datasets/"+d.id)}>打开数据集</Button><Button danger onClick={async() => {try {if(await permanentDelete("locDataset",[d.id])) await load();}catch(e){setError((e as Error).message);}}}>删除</Button></Space>
    </Card>)}</div>
    {!items.length && <Empty description="暂无小节与音符事件数据集"/>}
    <Modal title="新建小节与音符事件数据集" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={async values => {setBusy(true);try {const d=await api<LocDataset>("/v2/localization/datasets",json({...values,task:"rhythm"}));setOpen(false);go("/localization/datasets/"+d.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
        <Form.Item name="name" label="数据集名称" rules={[{required:true,whitespace:true}]}><Input maxLength={200}/></Form.Item>
        <Form.Item name="sourceDatasetId" label="关联切图数据集" rules={[{required:true}]} extra="只导入已确认且包含六线谱、简谱或歌词区域的谱页。直接引用原图。"><Select showSearch optionFilterProp="label" options={sources.map(s => ({value:s.id,label:s.name}))}/></Form.Item>
        <Form.Item name="description" label="描述"><Input.TextArea maxLength={2000}/></Form.Item><Button type="primary" htmlType="submit" loading={busy}>创建并生成样本</Button>
      </Form>
    </Modal>
  </>;
}
