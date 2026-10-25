"use client";
import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Card,Empty,Select,Slider,Space,Spin,Statistic,Table,Tag,Typography,Upload} from 'antd';
import {useSearchParams} from 'next/navigation';
import {api,clientId} from '../../shared/client';
import type {TrainingRun,Prediction} from '../../shared/training';
import {ErrorToast} from '../ui/toast';
import {useNavigation} from '../navigation';
const palette=['#635bff','#0088cc','#d89425','#18a17b','#d65c92','#777bc6','#89929e','#9857cf','#d06a42','#469ba7','#b48b28','#ba5d8f','#6279b8'];
export function ModelLab() {
 const query=useSearchParams(),{go}=useNavigation();
 const [runs,setRuns]=useState<TrainingRun[]>([]),[modelId,setModelId]=useState(query.get('model')||''),[online,setOnline]=useState(0),[confidence,setConfidence]=useState(0.25),[error,setError]=useState(''),[busy,setBusy]=useState(false),[job,setJob]=useState<Prediction|null>(null),[visible,setVisible]=useState<number[]>([]),[report,setReport]=useState<Record<string,Record<string,number>>|null>(null);
 const requestVersion=useRef(0);
 useEffect(()=>{let active=true,busy=false;const load=async()=>{if(busy)return;busy=true;try{const [items,workers]=await Promise.all([api<TrainingRun[]>('/v2/training/runs'),api<{online:boolean}[]>('/v2/training/workers')]);if(active){const ready=items.filter(r=>r.status==='completed');setRuns(ready);setOnline(workers.filter(w=>w.online).length);setModelId(old=>old||ready[0]?.id||'');setError('');}}catch(e){if(active)setError(e instanceof Error?e.message:'加载失败');}finally{busy=false;}};void load();const timer=setInterval(()=>void load(),5000);return()=>{active=false;clearInterval(timer);};},[]);
 useEffect(()=>{requestVersion.current++;setJob(null);setVisible([]);setReport(null);let active=true;if(modelId)void api<{evaluation:Record<string,Record<string,number>>}>(`/v2/training/runs/${modelId}/artifacts/report`).then(r=>{if(active)setReport(r.evaluation);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[modelId]);
 useEffect(()=>{if(!job||['completed','failed'].includes(job.status))return;let active=true,busy=false;const id=job.id;const timer=setInterval(()=>{if(busy)return;busy=true;void api<Prediction>('/v2/training/predictions/'+id).then(r=>{if(active)setJob(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{busy=false;});},1000);return()=>{active=false;clearInterval(timer);};},[job?.id,job?.status]);
 const model=runs.find(r=>r.id===modelId),waiting=busy||!!job&&['queued','running'].includes(job.status);
 const boxes=(job?.boxes||[]).filter(b=>!visible.length||visible.includes(b.classId));
 async function predict(file:File) {
  const version=++requestVersion.current;setBusy(true);setError('');setJob(null);
  try{if(file.size>20*1024*1024)throw Error('图片不能超过 20 MB');const result=await api<Prediction>(`/v2/training/models/${modelId}/predict?confidence=${confidence}`,{method:'POST',headers:{'Content-Type':file.type,'X-Request-Id':clientId()},body:file});if(version===requestVersion.current)setJob(result);}
  catch(e){if(version===requestVersion.current)setError(e instanceof Error?e.message:'上传失败');}finally{if(version===requestVersion.current)setBusy(false);}
 }
 return <><div className="section-head"><div><h1>图片推理</h1><p className="muted">上传一张谱子，查看模型定位的区域、类别和置信度</p></div><Button onClick={()=>go('/training')}>训练记录</Button></div><ErrorToast>{error}</ErrorToast>
  <Alert type={online?'success':'warning'} showIcon message={online?`${online} 个推理 worker 在线`:'本地推理 worker 离线'} description={online?'图片通过平台交给在线 worker，结果会自动显示。':<Space direction="vertical"><Typography.Text>请在训练电脑运行下方命令并保持终端打开。</Typography.Text><Typography.Text code copyable>powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\training\start.ps1 -WorkerOnly</Typography.Text></Space>}/>
  <Card style={{marginTop:16}}><Space wrap align="center"><Typography.Text>模型</Typography.Text><Select style={{width:320,maxWidth:'100%'}} placeholder="选择已完成模型" value={modelId||undefined} disabled={waiting} onChange={setModelId} options={runs.map(r=>({value:r.id,label:r.name}))}/><Typography.Text>置信度</Typography.Text><Slider style={{width:180}} min={0.05} max={0.95} step={0.05} value={confidence} disabled={waiting} onChange={setConfidence} tooltip={{formatter:v=>`${Math.round((v||0)*100)}%`}}/><Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} disabled={!model||!online||waiting} beforeUpload={file=>{void predict(file);return false;}}><Button type="primary" disabled={!model||!online||waiting} loading={waiting}>上传谱子并推理</Button></Upload></Space>
   {model&&<Typography.Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>训练分辨率 {model.config.imgsz} · {model.config.model} · <Button type="link" onClick={()=>go('/training/'+model.id)}>查看训练过程</Button></Typography.Paragraph>}
   {report&&<Space style={{marginTop:12}} wrap>{Object.entries(report).map(([split,m])=><Tag key={split}>{split} 最佳模型 mAP50：{typeof m['metrics/mAP50(B)']==='number'?(m['metrics/mAP50(B)']*100).toFixed(2)+'%':'—'}</Tag>)}</Space>}
  </Card>
  {!runs.length&&<Card style={{marginTop:16}}><Empty description="还没有完成并上传的模型"/></Card>}
  {job?.status==='failed'&&<Alert type="error" message={job.error||'推理失败'} style={{marginTop:16}}/>}
  {job&&<div className="model-lab-grid"><Card title={job.status==='completed'?'推理结果':job.status==='queued'?'等待 worker 接单':'正在推理'} extra={job.elapsed_ms!==null?`${Math.round(job.elapsed_ms)} ms`:undefined}>
   <Space wrap style={{marginBottom:12}}><Tag>{job.width} × {job.height}</Tag><Tag>{job.boxes?.length??0} 个区域</Tag><Select mode="multiple" style={{minWidth:220,maxWidth:'100%'}} placeholder="显示所有类别" value={visible} onChange={setVisible} options={model?.categories.map(c=>({value:c.id,label:c.key}))}/></Space>
   <Spin spinning={job.status==='queued'||job.status==='running'}><svg viewBox={`0 0 ${job.width} ${job.height}`} style={{width:'100%',display:'block',background:'#f3f4f6'}} role="img" aria-label="谱子区域检测结果">
    <image href={`/api/v2/training/predictions/${job.id}/image`} width={job.width} height={job.height}/>
    {boxes.map((b,i)=><g key={i}><title>{b.classKey} {(b.score*100).toFixed(1)}%</title><rect x={b.x} y={b.y} width={b.width} height={b.height} fill={palette[b.classId%palette.length]+'12'} stroke={palette[b.classId%palette.length]} strokeWidth={Math.max(2,job.width/650)}/><text x={b.x+3} y={Math.max(14,b.y-4)} fontSize={Math.max(12,job.width/90)} fontWeight="600" fill={palette[b.classId%palette.length]} paintOrder="stroke" stroke="white" strokeWidth="2">{b.classKey} {(b.score*100).toFixed(0)}%</text></g>)}
   </svg></Spin>
  </Card><Card title="检测区域"><Statistic title="显示区域" value={boxes.length}/><Table rowKey={(_,i)=>String(i)} size="small" pagination={{pageSize:15}} dataSource={boxes} columns={[{title:'类别',dataIndex:'classKey',render:(s:string,b:NonNullable<Prediction['boxes']>[number])=><Tag color={palette[b.classId%palette.length]}>{s}</Tag>},{title:'置信度',dataIndex:'score',render:(s:number)=>(s*100).toFixed(1)+'%'},{title:'位置',render:(_:unknown,b:NonNullable<Prediction['boxes']>[number])=>`${b.x}, ${b.y} · ${b.width}×${b.height}`}]} locale={{emptyText:job.status==='completed'?'该阈值下未检出区域':'等待推理结果'}}/>
   {job.status==='completed'&&<Button onClick={()=>{const blob=new Blob([JSON.stringify(job,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='prediction-'+job.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>导出结果 JSON</Button>}
  </Card></div>}
 </>;
}
