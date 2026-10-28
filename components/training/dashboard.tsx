"use client";
import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Card,Empty,Image,Progress,Space,Statistic,Table,Tag,Typography} from 'antd';
import {api} from '../../shared/client';
import type {TrainingRun,TrainingEvent} from '../../shared/training';
import {useNavigation} from '../navigation';
import {ErrorToast} from '../ui/toast';
const names:Record<string,string>={created:'等待训练',running:'训练中',exporting:'评估与上传',completed:'已完成',failed:'失败',cancelled:'已取消'};
const colors:Record<string,string>={running:'processing',exporting:'warning',completed:'success',failed:'error'};
const percent=(n:number|undefined)=>n===undefined?'—':(n*100).toFixed(2)+'%';
export function MetricChart({events,keys,title}:{events:TrainingEvent[];keys:{key:string;color:string;label:string}[];title:string}) {
 const data=events.filter(e=>e.kind==='epoch');
 if(!data.length)return <Card title={title}><Empty description="第一轮训练结束后显示曲线"/></Card>;
 const values=data.flatMap(e=>keys.map(k=>e.payload.metrics?.[k.key]).filter((v):v is number=>typeof v==='number'));
 if(!values.length)return <Card title={title}><Empty description="暂无对应指标"/></Card>;
 const max=keys.every(k=>k.key.startsWith('metrics/'))?1:Math.max(...values,0.001)*1.08,x=(i:number)=>46+i/Math.max(1,data.length-1)*700,y=(v:number)=>194-v/max*160;
 return <Card title={title} size="small"><svg viewBox="0 0 800 240" role="img" aria-label={title} style={{width:'100%',display:'block'}}>
  {[0,0.25,0.5,0.75,1].map(t=><g key={t}><line x1="46" y1={y(max*t)} x2="746" y2={y(max*t)} stroke="#e8ebf0"/><text x="3" y={y(max*t)+4} fontSize="11" fill="#667085">{(max*t).toFixed(3)}</text></g>)}
  {keys.map(k=><polyline key={k.key} fill="none" stroke={k.color} strokeWidth="2.2" points={data.map((e,i)=>{const v=e.payload.metrics?.[k.key];return typeof v==='number'?`${x(i)},${y(v)}`:'';}).filter(Boolean).join(' ')}/>)}
  <text x="46" y="214" fontSize="11" fill="#667085">Epoch {data[0].payload.epoch}</text><text x="680" y="214" fontSize="11" fill="#667085">Epoch {data.at(-1)?.payload.epoch}</text>
  {keys.map((k,i)=><g key={k.key}><circle cx={60+i*180} cy="233" r="4" fill={k.color}/><text x={70+i*180} y="237" fontSize="12" fill="#475467">{k.label}</text></g>)}
 </svg></Card>;
}
export function TrainingList() {
 const [items,setItems]=useState<TrainingRun[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');const {go}=useNavigation();
 useEffect(()=>{let active=true,busy=false;const load=async()=>{if(busy)return;busy=true;try{const r=await api<TrainingRun[]>('/v2/training/runs');if(active){setItems(r);setError('');}}catch(e){if(active)setError(e instanceof Error?e.message:'加载失败');}finally{busy=false;if(active)setLoading(false);}};void load();const timer=setInterval(()=>void load(),3000);return()=>{active=false;clearInterval(timer);};},[]);
 return <><div className="section-head"><div><h1>模型训练</h1><p className="muted">本地训练 · 实时指标 · 模型归档</p></div><Button type="primary" onClick={()=>go('/layout/models')}>图片推理</Button></div>
  <ErrorToast>{error}</ErrorToast>
  <Alert type="info" showIcon message="在本机启动训练" description={<Space direction="vertical"><Typography.Text>运行项目中的 tools/training/start.ps1，程序会拉取人工确认和已确认合成页，并自动上报到这里。</Typography.Text><Typography.Text code copyable>powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\training\start.ps1</Typography.Text></Space>}/>
  <Card style={{marginTop:20}}><Table<TrainingRun> rowKey="id" size="small" loading={loading} dataSource={items} pagination={{pageSize:10}} scroll={{x:880}} columns={[
   {title:'训练任务',dataIndex:'name',render:(v:string,r:TrainingRun)=><Button type="link" onClick={()=>go('/layout/training/'+r.id)}>{v}</Button>},
   {title:'状态',dataIndex:'status',render:(v:string)=><Tag color={colors[v]}>{names[v]}</Tag>},
   {title:'进度',render:(_:unknown,r:TrainingRun)=><Progress size="small" percent={Math.round(r.last_epoch/r.config.epochs*100)} format={()=>`${r.last_epoch}/${r.config.epochs}`} status={r.status==='failed'?'exception':r.status==='completed'?'success':'normal'}/>},
   {title:'最近 mAP50',render:(_:unknown,r:TrainingRun)=>percent(r.metrics['metrics/mAP50(B)'])},
   {title:'训练页数',render:(_:unknown,r:TrainingRun)=>r.dataset_summary.splits?.train?.pages??'—'},
   {title:'更新时间',dataIndex:'updated_at',render:(v:string)=>new Date(v).toLocaleString()},
  ]}/></Card></>;
}
export function TrainingDetail({id}:{id:string}) {
 const [run,setRun]=useState<TrainingRun|null>(null),[events,setEvents]=useState<TrainingEvent[]>([]),[error,setError]=useState('');
 const cursor=useRef(0);const {go}=useNavigation();
 useEffect(()=>{let active=true,busy=false;cursor.current=0;setEvents([]);setRun(null);
  const load=async()=>{if(busy)return;busy=true;try{const r=await api<TrainingRun>('/v2/training/runs/'+id);if(!active)return;setRun(r);let more:TrainingEvent[]=[];
   do {more=await api<TrainingEvent[]>(`/v2/training/runs/${id}/events?after=${cursor.current}`);if(!active)return;if(more.length){cursor.current=more.at(-1)!.seq;setEvents(old=>[...old,...more]);}}while(more.length===1000);
   setError('');}catch(e){if(active)setError(e instanceof Error?e.message:'加载失败');}finally{busy=false;}};
  void load();const timer=setInterval(()=>void load(),2000);return()=>{active=false;clearInterval(timer);};
 },[id]);
 if(!run)return <><ErrorToast>{error}</ErrorToast><Card loading={!error}><Empty description={error?'无法加载训练':'正在加载训练'}/></Card></>;
 const stale=['running','exporting'].includes(run.status)&&!!run.heartbeat_at&&Date.now()-Date.parse(run.heartbeat_at)>60000;
 const epochEvents=events.filter(e=>e.kind==='epoch'),logEvents=events.filter(e=>e.kind==='log'||e.kind==='state').slice(-100).reverse();
 return <><div className="section-head"><div><Button type="link" onClick={()=>go('/layout/training')}>返回训练列表</Button><h1>{run.name} <Tag color={colors[run.status]}>{names[run.status]}</Tag></h1></div><Button disabled={run.status!=='completed'} type="primary" onClick={()=>go('/layout/models?model='+run.id)}>测试这个模型</Button></div>
  <ErrorToast>{error}</ErrorToast>
  {stale&&<Alert style={{marginBottom:16}} type="warning" showIcon message="超过 60 秒未收到上报" description="本机可能暂停或断网。已上传指标保留，本地待传事件会在恢复连接后补传。"/>}
  {run.error&&<Alert type="error" message={run.error} style={{marginBottom:16}}/>}
  <div className="training-stats"><Card><Statistic title="已完成轮次" value={run.last_epoch} suffix={'/ '+run.config.epochs}/><Progress percent={Math.round(run.last_epoch/run.config.epochs*100)} status={run.status==='completed'?'success':'normal'}/></Card><Card><Statistic title="最近一轮 mAP50" value={percent(run.metrics['metrics/mAP50(B)'])}/></Card><Card><Statistic title="最近一轮 mAP50–95" value={percent(run.metrics['metrics/mAP50-95(B)'])}/></Card><Card><Statistic title="最近一轮召回率" value={percent(run.metrics['metrics/recall(B)'])}/></Card></div>
  <div className="training-charts"><MetricChart title="验证集识别效果" events={events} keys={[{key:'metrics/mAP50(B)',color:'#635bff',label:'mAP50'},{key:'metrics/mAP50-95(B)',color:'#18a999',label:'mAP50–95'},{key:'metrics/recall(B)',color:'#e9a23b',label:'Recall'}]}/><MetricChart title="训练损失" events={events} keys={[{key:'train/box_loss',color:'#635bff',label:'Box loss'},{key:'train/cls_loss',color:'#18a999',label:'Class loss'},{key:'train/dfl_loss',color:'#e9a23b',label:'DFL loss'}]}/></div>
  <Card title="数据与训练配置" style={{marginTop:16}}><Space wrap><Tag>{run.config.model}</Tag><Tag>分辨率 {run.config.imgsz}</Tag><Tag>Batch {run.config.batch}</Tag><Tag>去重 {run.dataset_summary.duplicatesRemoved} 页</Tag></Space>
   <Table size="small" rowKey="split" pagination={false} dataSource={Object.entries(run.dataset_summary.splits||{}).map(([split,s])=>({split,...s}))} columns={[{title:'集合',dataIndex:'split'},{title:'页数',dataIndex:'pages'},{title:'合成页',dataIndex:'synthetic'},{title:'其他已确认页',dataIndex:'confirmedOther'},{title:'标注框',dataIndex:'boxes'}]}/>
   {run.dataset_summary.warnings?.map(w=><Alert key={w} type="warning" message={w} style={{marginTop:8}}/>)}
   <Typography.Paragraph type="secondary" style={{marginTop:12}}>数据指纹：<Typography.Text copyable code>{run.fingerprint}</Typography.Text></Typography.Paragraph>
  </Card>
  <Card title="模型文件与评估图" style={{marginTop:16}}><Space wrap>{run.artifacts?.map(a=><Button key={a.kind} href={`/api/v2/training/runs/${id}/artifacts/${a.kind}`} target="_blank" rel="noreferrer">{a.kind} · {(Number(a.bytes)/1024/1024).toFixed(1)} MB</Button>)}</Space>
   {!run.artifacts?.length&&<Empty description="训练结束后自动上传模型和评估结果"/>}
   <div className="training-previews">{run.artifacts?.filter(a=>['results','confusion','preview'].includes(a.kind)).map(a=><div key={a.kind}><Typography.Text>{({results:'训练曲线',confusion:'验证集混淆矩阵',preview:'验证集预测示例'} as Record<string,string>)[a.kind]}</Typography.Text><Image alt={a.kind} src={`/api/v2/training/runs/${id}/artifacts/${a.kind}`}/></div>)}</div>
  </Card>
  <Card title="逐轮指标" style={{marginTop:16}}><Table rowKey="seq" size="small" dataSource={[...epochEvents].reverse()} pagination={{pageSize:10}} scroll={{x:640}} columns={[
   {title:'Epoch',render:(_:unknown,e:TrainingEvent)=>e.payload.epoch},...['metrics/precision(B)','metrics/recall(B)','metrics/mAP50(B)','metrics/mAP50-95(B)'].map(k=>({title:k.replace('metrics/','').replace('(B)',''),render:(_:unknown,e:TrainingEvent)=>percent(e.payload.metrics?.[k])})),
  ]}/></Card>
  <Card title="训练事件" style={{marginTop:16}}>{logEvents.length?logEvents.map(e=><Typography.Paragraph key={e.seq}><Typography.Text type="secondary">{new Date(e.created_at).toLocaleTimeString()} </Typography.Text>{e.payload.message||names[e.payload.status||'']||e.kind}</Typography.Paragraph>):<Empty description="暂无事件"/>}</Card>
 </>;
}
