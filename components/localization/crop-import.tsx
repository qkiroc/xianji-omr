"use client";
import {useState} from "react";
import {Button,Form,Input,Modal,Select,Space,Upload} from "antd";
import {api,json,type Dataset} from "../../shared/client";
import {ErrorToast} from "../ui/toast";

export function CropImport({datasetId,onImported}:{datasetId:string;onImported:()=>void}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [file,setFile]=useState<File|null>(null),[sources,setSources]=useState<Dataset[]>([]),[sourceId,setSourceId]=useState<string>();
  const [form]=Form.useForm();
  return <>
    <Button onClick={()=>{setOpen(true);void api<Dataset[]>("/v2/datasets").then(setSources).catch(e=>setError(e.message));}}>导入裁片</Button>
    <ErrorToast>{error}</ErrorToast>
    <Modal title="导入独立裁片" open={open} onCancel={()=>{if(!busy)setOpen(false);}} footer={null} destroyOnHidden>
      <p>上传切图模型输出的谱行图片，直接开始标注小节和事件。</p>
      <Form form={form} layout="vertical" initialValues={{track:"guitar",split:"train"}} onFinish={async values=>{
        if(!file){setError("请选择裁片图片");return;}setBusy(true);setError("");
        try{
          const imageBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=reject;reader.readAsDataURL(file);});
          await api("/v2/localization/datasets/"+datasetId+"/crops",json({...values,title:values.title||file.name,imageBase64}));
          setFile(null);setOpen(false);form.resetFields();onImported();
        }catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>
        <Form.Item label="谱行图片"><Upload accept="image/*" maxCount={1} beforeUpload={f=>{if(f.size>1200000){setError("请使用小于 1.2 MB 的谱行裁片");return Upload.LIST_IGNORE;}setFile(f);return false;}} onRemove={()=>setFile(null)}><Button disabled={busy}>选择裁片</Button></Upload></Form.Item>
        <Form.Item name="title" label="名称"><Input maxLength={200}/></Form.Item>
        <Form.Item name="track" label="类型"><Select options={[{value:"guitar",label:"六线谱"},{value:"melody",label:"简谱"},{value:"lyrics",label:"歌词"}]}/></Form.Item>
        <Form.Item name="groupKey" label="歌曲分组" extra="同一首歌的裁片请填写相同的分组，保持集合划分一致。"><Input maxLength={200}/></Form.Item>
        <Form.Item name="split" label="集合"><Select options={[{value:"train",label:"训练集"},{value:"val",label:"验证集"},{value:"test",label:"测试集"}]}/></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>上传裁片</Button>
      </Form>
      <p className="muted">也可以将已有切图结果一次性复制为独立裁片，后续修改和删除来源不会影响这里的数据。</p>
      <Space><Select aria-label="本次导入来源" placeholder="选择本次导入来源" style={{width:240}} value={sourceId} onChange={setSourceId} options={sources.map(s=>({value:s.id,label:s.name}))}/>
        <Button disabled={!sourceId||busy} loading={busy} onClick={async()=>{setBusy(true);try{await api("/v2/localization/datasets/"+datasetId+"/sync",json({sourceDatasetId:sourceId}));setOpen(false);onImported();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>导入</Button></Space>
    </Modal>
  </>;
}
