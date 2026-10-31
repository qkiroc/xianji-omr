"use client";
import { useEffect, useState } from "react";
import { Button, Empty, Input, Modal, Select, Space, Statistic, Table, Tag } from "antd";
import { useSearchParams } from "next/navigation";
import { api, json, useQueryString, type PageResult } from "../../shared/client";
import type { LocDataset, LocalizationRecord } from "../../shared/localization";
import type { AnnotationTrend } from "../../shared/annotation-trend";
import { useNavigation } from "../navigation";
import { ErrorToast } from "../ui/toast";
import { KeyDailyChart } from "../key-signatures/daily-chart";
import { permanentDelete } from "../../shared/permanent-delete";
interface ListResult extends PageResult<LocalizationRecord & {measure_count:number;event_count:number;page_order:string;line_index:string}> {
  dataset:LocDataset;stats:{total:number;confirmed:number};annotationTrend:AnnotationTrend;
}
export function LocalizationRecords({datasetId}:{datasetId:string}) {
  const q=useSearchParams(),{go}=useNavigation(),base="/localization/datasets/"+datasetId;
  const [data,setData]=useState<ListResult|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const [exportsOpen,setExportsOpen]=useState(false),[snapshots,setSnapshots]=useState<{id:string;created_at:string}[]>([]),[busy,setBusy]=useState(false);
  const update=(values:Record<string,string|number|undefined>) => go(base+"?"+useQueryString(new URLSearchParams(q),values));
  useEffect(() => {let active=true;setLoading(true);api<ListResult>("/v2"+base+"/records?"+q).then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[base,q,revision]);
  const getSnapshots=async()=>setSnapshots(await api("/v2"+base+"/snapshots"));
  return <>
    <div className="section-head"><div><Button onClick={()=>go("/localization/datasets")}>返回数据集</Button><h1>{data?.dataset.name || "小节与音符事件"}</h1><p className="muted">每条数据一个完整谱行 · 六线谱 / 简谱 / 歌词分别框选 · 只标区域位置和类别</p></div>
      <Space><Button loading={busy} disabled={!data?.dataset.source_dataset_id} onClick={async()=>{setBusy(true);try{const r=await api<{imported:number}>("/v2"+base+"/sync",json({}));Modal.success({title:`新增 ${r.imported} 行`,content:"已有标注保持不变。"});setRevision(n=>n+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>同步新增谱行</Button><Button onClick={async()=>{setExportsOpen(true);try{await getSnapshots();}catch(e){setError((e as Error).message);}}}>冻结与导出</Button></Space></div>
    <ErrorToast>{error}</ErrorToast>
    <Space size="large" className="rhythm-statistics"><Statistic title="总谱行" value={data?.stats.total||0}/><Statistic title="草稿" value={(data?.stats.total||0)-(data?.stats.confirmed||0)}/><Statistic title="已确认" value={data?.stats.confirmed||0}/></Space>
    {data?.annotationTrend && <KeyDailyChart name="小节与音符事件" trend={data.annotationTrend} onDaysChange={days=>update({trendDays:days})}/>}
    <Space wrap className="rhythm-filters"><Input.Search aria-label="搜索谱行" placeholder="歌曲或谱行名称" defaultValue={q.get("search")||""} allowClear onSearch={search=>update({search,page:1})}/>
      <Select aria-label="复核状态" value={q.get("status")||""} style={{width:140}} onChange={status=>update({status,page:1})} options={[{value:"",label:"全部状态"},{value:"draft",label:"草稿"},{value:"confirmed",label:"已确认"}]}/><Select aria-label="集合类型" value={q.get("split")||""} style={{width:140}} onChange={split=>update({split,page:1})} options={[{value:"",label:"全部集合"},{value:"train",label:"训练集"},{value:"val",label:"验证集"},{value:"test",label:"测试集"}]}/></Space>
    <Table size="small" loading={loading} rowKey="id" dataSource={data?.items||[]} scroll={{x:800}} onRow={r=>({onClick:()=>go(base+"/records/"+r.id+"?"+q),className:"clickable"})}
      pagination={{current:data?.page||1,pageSize:data?.pageSize||50,total:data?.total||0,showSizeChanger:true,pageSizeOptions:[10,25,50,100],onChange:(page,pageSize)=>update({page,pageSize})}}
      columns={[{title:"歌曲 / 谱行",dataIndex:"title"},{title:"来源页",dataIndex:"page_order",width:85},{title:"行序号",dataIndex:"line_index",width:85},{title:"小节",dataIndex:"measure_count",width:80},{title:"音符 / 歌词事件",dataIndex:"event_count",width:140},
        {title:"集合",dataIndex:"split",width:90,render:(v:string)=>({train:"训练集",val:"验证集",test:"测试集"}[v])},{title:"状态",dataIndex:"status",width:90,render:(v:string)=><Tag color={v==="confirmed"?"green":"default"}>{v==="confirmed"?"已确认":"草稿"}</Tag>},
        {title:"更新时间",dataIndex:"updated_at",render:(v:string)=>new Date(v).toLocaleString()},{title:"操作",width:100,render:(_,r)=><Button danger size="small" onClick={async e=>{e.stopPropagation();try{if(await permanentDelete("locRecord",[r.id]))setRevision(n=>n+1);}catch(e){setError((e as Error).message);}}}>删除</Button>}]}/>
    {!loading && !data?.items.length && <Empty description="暂无样本，请确认切图后同步新增谱行"/>}
    <Modal title="冻结与导出" open={exportsOpen} onCancel={()=>setExportsOpen(false)} footer={null} width={720}><p>只导出已确认数据。JSON 保留小节与事件区域、基础类别和原图坐标；ZIP 包含裁片、区域标签、集合划分和来源映射。</p>
      <Button loading={busy} disabled={!data?.stats.confirmed} onClick={async()=>{setBusy(true);try{await api("/v2"+base+"/snapshots",json({}));await getSnapshots();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>冻结全部已确认数据</Button><p className="muted small">每个快照最多 100 行 / 3,000 个小节；更大的数据集可通过 CLI 按 recordIds 分批冻结。</p>
      {snapshots.map(s=><div className="panel" key={s.id}><p>{new Date(s.created_at).toLocaleString()}</p><Space><a href={"/api/v2/localization/snapshots/"+s.id+"/native"}>标注 JSON</a><a href={"/api/v2/localization/snapshots/"+s.id+"/crops"}>裁片与标签 ZIP</a><Button danger size="small" onClick={async()=>{try{if(await permanentDelete("locSnapshot",[s.id]))await getSnapshots();}catch(e){setError((e as Error).message);}}}>删除快照</Button></Space></div>)}
    </Modal>
  </>;
}
