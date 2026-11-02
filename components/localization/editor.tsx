"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Empty, InputNumber, Select, Space, Tabs, Tag } from "antd";
import type { Geometry, LocEvent, LocalizationRecord, Measure, RhythmDuration, XYXY } from "../../shared/localization";
import { api, json, clientId, clone } from "../../shared/client";
import { eventName, newRhythm, orderedEvents, RHYTHM_NAMES, RHYTHM_VALUES, TRACK_NAMES } from "../../shared/rhythm";
import { useDirty, useNavigation } from "../navigation";
import { ErrorToast } from "../ui/toast";
import { clearRegionDraft, keepRegionDraft, readRegionDraft } from "../../shared/localization-draft";
import { RhythmProperties } from "./rhythm-properties";

type Mode = "select" | "measure" | "event";
type Drag = { kind:"measure"|"event"|"move-measure"|"move-event"|"corner-measure"|"corner-event"; mid:string;eid?:string;corner?:number;x:number;y:number;before:Geometry };
const COLORS=["#9857cf","#dd6689","#228dce","#d89425","#26a17b","#6279b8"];
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const rect=(a:number,b:number,c:number,d:number):XYXY=>[Math.min(a,c),Math.min(b,d),Math.max(a,c),Math.max(b,d)];
const color=(e:LocEvent)=>COLORS[RHYTHM_VALUES.indexOf(e.rhythm?.duration as RhythmDuration)] || "#26a17b";

export function LocalizationEditor({datasetId,recordId}:{datasetId:string;recordId:string}) {
  const {go}=useNavigation(),q=useSearchParams(),base="/localization/datasets/"+datasetId;
  const [record,setRecord]=useState<LocalizationRecord|null>(null),[geometry,setGeometry]=useState<Geometry|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [image,setImage]=useState(""),[retry,setRetry]=useState(0),[mode,setMode]=useState<Mode>("select"),[view,setView]=useState("crop"),[zoom,setZoom]=useState(1);
  const [regionId,setRegionId]=useState(""),[mid,setMid]=useState(""),[eid,setEid]=useState(""),[duration,setDuration]=useState<RhythmDuration>(4);
  const [history,setHistory]=useState<Geometry[]>([]),[future,setFuture]=useState<Geometry[]>([]),[queue,setQueue]=useState<{previousId:string|null;nextId:string|null}>({previousId:null,nextId:null});
  const current=useRef(geometry),saved=useRef(record),drag=useRef<Drag|null>(null),busyRef=useRef(false);
  current.current=geometry;saved.current=record;
  const region=geometry?.regions?.find(r=>r.id===regionId), measure=geometry?.measures.find(m=>m.id===mid), event=measure?.events.find(e=>e.id===eid);
  const page=geometry?.pages.find(p=>p.localPageId===(region?.pageId || measure?.pageId)) || geometry?.pages[0];
  const activeMeasures=geometry?.measures.filter(m=>!region || m.regionId===region.id)||[];
  const sampleBounds:XYXY=geometry?.sample?.bbox || (page?[0,0,page.width,page.height]:[0,0,1,1]);
  const bounds:XYXY=view==="crop"&&region?region.bbox:sampleBounds;
  const label=event?.rhythm;
  const refreshQueue=useCallback(async()=>{try {setQueue(await api("/v2"+base+"/editor?"+new URLSearchParams({recordId,status:q.get("status")||"",split:q.get("split")||"",search:q.get("search")||""})));}catch(e){setError((e as Error).message);}},[base,recordId,q]);
  useEffect(()=>{
    let active=true;
    // Effects rerun during frontend HMR. Preserve the current selection before
    // fetching so an API restart cannot replace unsaved regions with empty data.
    if(saved.current?.id===recordId&&current.current&&!same(current.current,saved.current.geometry))keepRegionDraft(window.localStorage,saved.current,current.current);
    api<LocalizationRecord>("/v2/localization/records/"+recordId).then(r=>{
      if(!active)return;if(r.dataset_id!==datasetId)throw Error("记录不属于此数据集");
      if(r.geometry.schemaVersion!=="omr-rhythm-v1")throw Error("这是旧定位样本，请删除旧数据集并从切图生成新样本。");
      const restored=readRegionDraft(window.localStorage,r),g=restored||r.geometry;
      setRecord(r);setGeometry(g);current.current=g;saved.current=r;
      setView("crop");
      const m=g.measures.find(m=>m.id===q.get("measure"));setRegionId(m?.regionId||g.regions?.[0]?.id||"");setMid(m?.id||"");setEid("");setDirty(!!restored&&!same(g,r.geometry));setHistory([]);setFuture([]);
    }).catch(e=>{if(active)setError(e.message);});void refreshQueue();
    return()=>{active=false;};
  },[recordId,datasetId]);
  useEffect(()=>{
    if(!page)return;const controller=new AbortController();let url="";
    const path="/api/v2/localization/records/"+recordId+"/content";
    setImage("");fetch(path,{cache:"no-store",signal:controller.signal}).then(async r=>{
      if(!r.ok)throw Error("原图读取失败，请重试");url=URL.createObjectURL(await r.blob());if(!controller.signal.aborted)setImage(url);else URL.revokeObjectURL(url);
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
  },[page?.sourcePageId,recordId,geometry?.sample?.id,retry]);
  const commit=(next:Geometry,before=current.current)=>{
    if(!before||same(next,before))return;
    for(const m of next.measures){const prev=before.measures.find(x=>x.id===m.id);if(!same(m,prev))m.geometryConfirmed=m.completenessConfirmed=false;}
    setHistory(h=>[...h.slice(-99),clone(before)]);setFuture([]);setGeometry(next);current.current=next;setDirty(true);
  };
  const edit=(change:(g:Geometry)=>void)=>{if(!current.current||busyRef.current||drag.current)return;const next=clone(current.current);change(next);commit(next);};
  const editEvent=(change:(e:LocEvent)=>void)=>edit(g=>{const e=g.measures.find(m=>m.id===mid)?.events.find(e=>e.id===eid);if(e)change(e);});
  const setCategory=(value:RhythmDuration)=>editEvent(e=>{e.rhythm={...e.rhythm,duration:value};});
  const undo=(redo=false)=>{
    if(busyRef.current||drag.current)return;const stack=redo?future:history;if(!stack.length||!current.current)return;
    const next=clone(stack[stack.length-1]),before=clone(current.current);if(redo){setFuture(f=>f.slice(0,-1));setHistory(h=>[...h,before]);}else{setHistory(h=>h.slice(0,-1));setFuture(f=>[...f,before]);}
    setGeometry(next);current.current=next;setDirty(true);
  };
  const saveDocument=useCallback(async()=>{
    if(!saved.current||!current.current)return;
    if(drag.current)throw Error("请先结束框选");
    const before=current.current,clean=clone(before);for(const m of clean.measures)m.events.sort((a,b)=>(a.centerX??Infinity)-(b.centerX??Infinity)||a.id.localeCompare(b.id));
    const r=await api<LocalizationRecord>("/v2/localization/records/"+recordId,json({version:saved.current.version,geometry:clean},"PUT"));
    saved.current=r;setRecord(r);if(current.current!==before)throw Error("前一版本已保存，请再次保存后续修改");
    setGeometry(r.geometry);current.current=r.geometry;setDirty(false);setHistory([]);setFuture([]);clearRegionDraft(window.localStorage,r);return r;
  },[recordId]);
  const save=useCallback(async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError("");try{await saveDocument();}catch(e){const message=(e as Error).message;setError(message==="事件类型无效"?"本地后端仍在运行旧版校验。请保留此页并重启本地服务，再保存区域标注。":message);throw e;}finally{busyRef.current=false;setBusy(false);}},[saveDocument]);
  useDirty(dirty,save);
  const openRecord=(id:string|null)=>{if(id)go(base+"/records/"+id+"?"+q);};
  const confirm=async(next=false)=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError("");
    try{if(drag.current)throw Error("请先结束框选");const r=await api<LocalizationRecord>("/v2/localization/records/"+recordId+"/confirm",json({version:saved.current!.version,geometry:current.current,acknowledged:true}));saved.current=r;setRecord(r);setGeometry(r.geometry);current.current=r.geometry;setDirty(false);setHistory([]);setFuture([]);clearRegionDraft(window.localStorage,r);
      if(next){const queue=await api<{nextId:string|null}>("/v2"+base+"/editor?"+new URLSearchParams({recordId,status:q.get("status")||"",split:q.get("split")||"",search:q.get("search")||""}));if(queue.nextId)setTimeout(()=>openRecord(queue.nextId),0);}
    }catch(e){setError((e as Error).message);}finally{busyRef.current=false;setBusy(false);}
  };
  const remove=()=>{
    if(!measure||busyRef.current||drag.current)return;
    edit(g=>{if(eid){const m=g.measures.find(m=>m.id===mid)!;m.events=m.events.filter(e=>e.id!==eid);}else g.measures=g.measures.filter(m=>m.id!==mid);});
    setEid("");if(!eid){setMid("");setMode("select");}
  };
  const pick=(m:Measure,e?:LocEvent)=>{setMid(m.id);setEid(e?.id||"");setRegionId(m.regionId||regionId);};
  const translateSelection=(dx:number,dy:number)=>edit(g=>{
    const m=g.measures.find(m=>m.id===mid);if(!m?.bbox)return;
    const ev=m.events.find(e=>e.id===eid),b=ev?.bbox||m.bbox,limit=ev?m.bbox:region?.bbox||[0,0,page!.width,page!.height];
    dx=clamp(dx,limit[0]-b[0],limit[2]-b[2]);dy=0;
    const shift=(b:XYXY):XYXY=>[b[0]+dx,b[1]+dy,b[2]+dx,b[3]+dy];
    if(ev){ev.bbox=shift(b);if(ev.centerX!==null)ev.centerX+=dx;}
    else{m.bbox=shift(b);if(m.staffLines)m.staffLines=m.staffLines.map(y=>y+dy);for(const e of m.events){if(e.bbox)e.bbox=shift(e.bbox);if(e.centerX!==null)e.centerX+=dx;if(e.contextBBox)e.contextBBox=shift(e.contextBBox);}}
  });
  useEffect(()=>{
    if(dirty&&saved.current&&current.current)keepRegionDraft(window.localStorage,saved.current,current.current);
    const key=(e:KeyboardEvent)=>{
      if(e.isComposing||document.querySelector(".ant-modal-wrap"))return;
      const input=e.target instanceof Element ? e.target.closest("input,textarea,[contenteditable=true],.ant-select") : null;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();if(!busyRef.current)void save().catch(()=>{});return;}
      if(input||busyRef.current||drag.current)return;
      if((e.ctrlKey||e.metaKey)&&["z","y"].includes(e.key.toLowerCase())){e.preventDefault();undo(e.shiftKey||e.key.toLowerCase()==="y");return;}
      if(e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.key==="Tab"){e.preventDefault();setView(v=>v==="crop"?"source":"crop");}
      else if(e.key==="Escape"){setMode("select");setEid("");}
      else if(e.key.toLowerCase()==="m")setMode("measure");
      else if(e.key.toLowerCase()==="e")setMode("event");
      else if(e.key.toLowerCase()==="v")setMode("select");
      else if(e.key.toLowerCase()==="q"){e.preventDefault();void remove();}
      else if(e.key==="Enter"){e.preventDefault();void confirm(true);}
      else if(e.key==="."&&event&&measure?.track!=="lyrics"){e.preventDefault();editEvent(ev=>{const dots=((ev.rhythm?.dots||0)+1)%4;ev.rhythm={...ev.rhythm!,dots:(dots||undefined) as 1|2|3|undefined};});}
      else if(e.key.toLowerCase()==="t"&&event&&measure?.track!=="lyrics"){e.preventDefault();editEvent(ev=>{ev.rhythm={...ev.rhythm!,tuplet:ev.rhythm?.tuplet?undefined:{actual:3,normal:2,groupId:clientId()}};});}
      else if(/^[1-6]$/.test(e.key)){const value=RHYTHM_VALUES[Number(e.key)-1];setDuration(value);if(event&&measure?.track!=="lyrics")setCategory(value);}
      else if(["ArrowLeft","ArrowRight"].includes(e.key)&&measure){e.preventDefault();const step=e.shiftKey?10:1;translateSelection(e.key==="ArrowLeft"?-step:e.key==="ArrowRight"?step:0,e.key==="ArrowUp"?-step:e.key==="ArrowDown"?step:0);}
    };window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
  });
  const point=(e:React.PointerEvent<SVGSVGElement>)=>{
    const svg=e.currentTarget,ctm=svg.getScreenCTM();if(!ctm)return{x:0,y:0};const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const n=p.matrixTransform(ctm.inverse());
    return{x:Math.round(clamp(n.x,0,page!.width)),y:0};
  };
  const down=(e:React.PointerEvent<SVGSVGElement>)=>{
    if(!geometry||!page||busyRef.current||e.button!==0)return;const p=point(e);const hit=(e.target as Element).closest("[data-kind]");
    if(mode==="measure"||mode==="event"){
      const parent=mode==="measure"?region?.bbox:measure?.bbox;if(!parent){setError(mode==="measure"?"请先选择来源谱行":"请先画小节或选择一个小节");return;}
      if(p.x<parent[0]||p.x>parent[2]){setError("请在当前谱行或小节范围内拖拽");return;}
      const next=clone(geometry),id=clientId();
      if(mode==="measure"){
        const m:Measure={id,pageId:page.localPageId,regionId:region!.id,systemId:region!.systemId,track:region!.track,voice:"1",barNumber:Math.max(0,...next.measures.filter(m=>m.track===region!.track).map(m=>m.barNumber||0))+1,bbox:[p.x,parent[1],p.x,parent[3]],staffLines:null,events:[],geometryConfirmed:false,completenessConfirmed:false,reviewNote:""};
        next.measures.push(m);drag.current={kind:"measure",mid:id,x:p.x,y:p.y,before:clone(geometry)};setMid(id);setEid("");
      }else{
        const ev:LocEvent={id,voice:"1",centerX:p.x,bbox:[p.x,parent[1],p.x,parent[3]],contextBBox:null,status:"accepted",evidence:{},annotationSource:{kind:"manual_rhythm"},confidence:null,rhythm:newRhythm(measure!.track,duration)};
        next.measures.find(m=>m.id===mid)!.events.push(ev);drag.current={kind:"event",mid,eid:id,x:p.x,y:p.y,before:clone(geometry)};setEid(id);
      }setGeometry(next);current.current=next;e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(!hit){setEid("");setMid("");return;}
    const m=geometry.measures.find(m=>m.id===hit.getAttribute("data-mid"));if(!m)return;const ev=m.events.find(ev=>ev.id===hit.getAttribute("data-eid"));pick(m,ev);
    drag.current={kind:hit.getAttribute("data-kind") as Drag["kind"],mid:m.id,eid:ev?.id,corner:Number(hit.getAttribute("data-corner")),x:p.x,y:p.y,before:clone(geometry)};e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move=(e:React.PointerEvent<SVGSVGElement>)=>{
    const d=drag.current;if(!d||!current.current||!page)return;const p=point(e),next=clone(d.kind==="measure"||d.kind==="event"?current.current:d.before),m=next.measures.find(m=>m.id===d.mid)!;
    const ev=m.events.find(e=>e.id===d.eid),parent=d.kind.includes("event")?m.bbox!:next.regions?.find(r=>r.id===m.regionId)?.bbox||[0,0,page.width,page.height];
    const px=clamp(p.x,parent[0],parent[2]);
    if(d.kind==="measure")m.bbox=rect(d.x,parent[1],px,parent[3]);
    else if(d.kind==="event"){ev!.bbox=rect(d.x,parent[1],px,parent[3]);ev!.centerX=Math.round((ev!.bbox[0]+ev!.bbox[2])/2);}
    else if(d.kind.startsWith("corner")){
      const b=clone(ev?.bbox||m.bbox!);b[d.corner===0||d.corner===3?0:2]=px;b[1]=parent[1];b[3]=parent[3];const result=rect(...b);
      if(ev){ev.bbox=result;ev.centerX=Math.round((result[0]+result[2])/2);}else m.bbox=result;
    }else{
      const b=ev?.bbox||m.bbox!,dx=clamp(p.x-d.x,parent[0]-b[0],parent[2]-b[2]),dy=0;
      const shift=(b:XYXY):XYXY=>[b[0]+dx,b[1]+dy,b[2]+dx,b[3]+dy];
      if(ev){ev.bbox=shift(b);if(ev.centerX!==null)ev.centerX+=dx;}else{m.bbox=shift(b);if(m.staffLines)m.staffLines=m.staffLines.map(y=>y+dy);for(const ev of m.events){if(ev.bbox)ev.bbox=shift(ev.bbox);if(ev.centerX!==null)ev.centerX+=dx;if(ev.contextBBox)ev.contextBBox=shift(ev.contextBBox);}}
    }setGeometry(next);current.current=next;
  };
  const cancelDrag=()=>{if(drag.current){setGeometry(drag.current.before);current.current=drag.current.before;drag.current=null;}};
  const finish=()=>{
    const d=drag.current;if(!d||!current.current)return;const next=current.current,m=next.measures.find(m=>m.id===d.mid)!,ev=m.events.find(e=>e.id===d.eid),b=ev?.bbox||m.bbox;
    if(!b||b[2]===b[0]){cancelDrag();return;}
    drag.current=null;commit(next,d.before);if(d.kind==="measure")setMode("select");
  };
  if(!record||!geometry)return <><ErrorToast>{error}</ErrorToast><Empty description={error?"标注样本加载失败":"正在加载标注样本"}/></>;
  const corners=(b:XYXY,m:Measure,ev?:LocEvent)=>[b[0],b[2]].map((x,i)=><rect key={i} data-kind={ev?"corner-event":"corner-measure"} data-mid={m.id} data-eid={ev?.id} data-corner={i===0?0:2} x={x-4} y={(b[1]+b[3])/2-7} width={8} height={14} style={{cursor:"ew-resize"}} fill="white" stroke={ev?color(ev):"#6d5eea"} vectorEffect="non-scaling-stroke"/>);
  return <>
    <div className="editor-toolbar rhythm-toolbar"><Space><Button onClick={()=>go(base+"?"+q)}>返回列表</Button><b title={record.title}>{record.title}</b></Space>
      <Space><Button disabled={!queue.previousId||busy} onClick={()=>openRecord(queue.previousId)}>上一行</Button><Button disabled={!queue.nextId||busy} onClick={()=>openRecord(queue.nextId)}>下一行</Button></Space>
      <Space><Tag color={dirty?"orange":record.status==="confirmed"?"green":"default"}>{dirty?"未保存":record.status==="confirmed"?"已确认":"草稿"}</Tag><Button disabled={!dirty||busy} loading={busy} onClick={()=>void save().catch(()=>{})}>保存</Button>
        {record.status==="confirmed"&&!dirty&&<Button disabled={busy} onClick={async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);try{const r=await api<LocalizationRecord>("/v2/localization/records/"+recordId+"/unconfirm",json({version:saved.current!.version}));saved.current=r;setRecord(r);setGeometry(r.geometry);current.current=r.geometry;}catch(e){setError((e as Error).message);}finally{busyRef.current=false;setBusy(false);}}}>取消确认</Button>}
        <Button type="primary" disabled={busy} onClick={()=>void confirm(true)}>确认并下一行</Button></Space></div>
    <div className="tools rhythm-tools"><Space wrap>{(["select","measure","event"] as const).map((key,i)=><Button key={key} type={mode===key?"primary":"default"} disabled={busy||(key==="event"&&!measure)} onClick={()=>{setMode(key);}}>{["选择 V","画小节 M","画事件 E"][i]}</Button>)}
      <Button disabled={!history.length||busy} onClick={()=>undo()}>撤销</Button><Button disabled={!future.length||busy} onClick={()=>undo(true)}>重做</Button><Button onClick={()=>setZoom(v=>Math.max(.25,v/1.25))}>缩小</Button><span>{Math.round(zoom*100)}%</span><Button onClick={()=>setZoom(v=>Math.min(4,v*1.25))}>放大</Button></Space>
      {(geometry.regions?.length||0)>1&&<Tabs activeKey={view} onChange={setView} items={[{key:"crop",label:"当前谱行"},{key:"source",label:"完整裁片"}]}/>}</div>
    <ErrorToast>{error}</ErrorToast>
    <div className="editor-body rhythm-editor" inert={busy}>
      <aside className="sidebar"><h3>本行区域</h3>{geometry.regions?.map((r,i)=><Button block key={r.id} className="rhythm-row-button" type={r.id===regionId?"primary":"default"} onClick={()=>{setRegionId(r.id);setMid("");setEid("");setMode("select");}}>{i+1}. {TRACK_NAMES[r.track]} · {geometry.measures.filter(m=>m.regionId===r.id).length} 小节</Button>)}
        <h3>当前谱行的小节</h3>{activeMeasures.map((m,i)=><div key={m.id}><Button block className="rhythm-row-button" type={mid===m.id&&!eid?"primary":"default"} onClick={()=>pick(m)}>第 {m.barNumber||i+1} 小节 · {m.events.filter(e=>e.status!=="rejected").length} 事件</Button>
          {m.id===mid&&orderedEvents(m).map((ev,j)=><Button key={ev.id} block size="small" className="rhythm-event-button" type={ev.id===eid?"primary":"text"} onClick={()=>pick(m,ev)}>{j+1}. {eventName(ev)}</Button>)}</div>)}
        {!activeMeasures.length&&<p className="muted">先在当前谱行拖拽画小节，再在小节内画事件框。</p>}
      </aside>
      <section className="loc-stage rhythm-stage" aria-label="小节与音符事件标注画布">
        <p className="rhythm-stage-hint">{mode==="event"?"在小节内横向拖动框选事件。":mode==="measure"?"横向拖动划分小节，选区高度固定为整行。":"拖动选区左右移动，拖动左右边缘调整宽度。"}</p>
        {image&&page?<svg aria-label="小节和音符事件选区" role="img" viewBox={`${bounds[0]} ${bounds[1]} ${bounds[2]-bounds[0]} ${bounds[3]-bounds[1]}`} style={{width:`${zoom*100}%`,maxWidth:"none",touchAction:"none"}} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelDrag}>
          <image href={image} x={sampleBounds[0]} y={sampleBounds[1]} width={sampleBounds[2]-sampleBounds[0]} height={sampleBounds[3]-sampleBounds[1]}/>
          {geometry.measures.filter(m=>m.pageId===page.localPageId&&(view==="source"||m.regionId===regionId)).map(m=>m.bbox&&<g key={m.id}>
            <rect data-kind="move-measure" data-mid={m.id} x={m.bbox[0]} y={m.bbox[1]} width={m.bbox[2]-m.bbox[0]} height={m.bbox[3]-m.bbox[1]} fill={mid===m.id?"#6d5eea0b":"transparent"} stroke="#6d5eea" strokeWidth={mid===m.id?2:1} vectorEffect="non-scaling-stroke"/>
            <text x={m.bbox[0]+3} y={m.bbox[1]+14} fontSize={12} fill="#6d5eea" pointerEvents="none">{m.barNumber} · {TRACK_NAMES[m.track]}</text>
            {m.events.filter(e=>e.status!=="rejected").map(ev=>ev.bbox&&<g key={ev.id}>
              <rect data-kind="move-event" data-mid={m.id} data-eid={ev.id} x={ev.bbox[0]} y={ev.bbox[1]} width={ev.bbox[2]-ev.bbox[0]} height={ev.bbox[3]-ev.bbox[1]} stroke={color(ev)} fill={eid===ev.id?color(ev)+"25":"transparent"} strokeWidth={eid===ev.id?2:1} vectorEffect="non-scaling-stroke"/>
              {eid===ev.id&&corners(ev.bbox,m,ev)}
            </g>)}
            {mid===m.id&&!eid&&corners(m.bbox,m)}
          </g>)}
        </svg>:<><Empty description="正在读取原图"/><Button onClick={()=>setRetry(n=>n+1)}>重试图片</Button></>}
      </section>
      <aside className="properties rhythm-properties">
        {event&&measure?<><h3>选中事件区域</h3><Tag color={color(event)}>{eventName(event)}</Tag>
          {measure.track!=="lyrics"?<>
            <label>基础时值（快捷键 1–6）</label><div className="rhythm-duration-grid">{RHYTHM_VALUES.map((value,i)=><Button key={value} type={label?.duration===value?"primary":"default"} style={{borderColor:COLORS[i]}} onClick={()=>{setDuration(value);setCategory(value);}}>{RHYTHM_NAMES[i]} <small>{i+1}</small></Button>)}</div>
            <RhythmProperties event={event} events={orderedEvents(measure)} onChange={rhythm=>editEvent(e=>{e.rhythm=rhythm;})} onGroup={()=>edit(g=>{
              const m=g.measures.find(m=>m.id===mid)!,events=orderedEvents(m),index=events.findIndex(e=>e.id===eid),t=event.rhythm?.tuplet;
              if(!t||index<0)return;const groupId=t.groupId||clientId();
              for(const ev of events.slice(index,index+t.actual))ev.rhythm={...ev.rhythm,duration:ev.rhythm?.duration??duration,tuplet:{...t,groupId}};
            })}/>
          </>:<p className="muted">只框选歌词区域，文字内容留给后续模型识别。</p>}
          <p className="muted small">横坐标 {event.bbox?.[0]} – {event.bbox?.[2]} · 高度固定</p><Button danger onClick={()=>void remove()}>删除 Q</Button>
          <h3>所在小节上下文</h3><CropPreview image={image} bbox={measure.bbox} event={event} imageBounds={sampleBounds}/>
        </>:measure?<><h3>选中小节区域</h3><Tag>{TRACK_NAMES[measure.track]}</Tag>
          <label>小节序号（可选）</label><InputNumber min={1} precision={0} value={measure.barNumber} onChange={barNumber=>edit(g=>{g.measures.find(m=>m.id===mid)!.barNumber=barNumber;})}/>
          <p className="muted small">横坐标 {measure.bbox?.[0]} – {measure.bbox?.[2]} · 高度固定</p><Button danger onClick={()=>void remove()}>删除 Q</Button><h3>事件区域</h3>
          {orderedEvents(measure).map((event,i)=><Button key={event.id} block className="rhythm-row-button" onClick={()=>pick(measure,event)}>{i+1}. {eventName(event)} · {event.bbox?.[0]} – {event.bbox?.[2]}</Button>)}
        </>:<><h3>当前谱行</h3><p>{region?TRACK_NAMES[region.track]:"请选择来源谱行"}</p><p className="muted">先画小节，再框选事件区域。本阶段只标位置和区域类别。</p>
          {region?.track!=="lyrics"&&<><h3>新建事件默认类别</h3><Select value={duration} onChange={setDuration} options={RHYTHM_VALUES.map((value,i)=>({value,label:RHYTHM_NAMES[i]}))}/></>}
        </>}
      </aside>
    </div>
    <footer className="caption">Ctrl/Cmd+S 保存 · Ctrl/Cmd+Z 撤销 · Shift+Ctrl/Cmd+Z 重做 · 1–6 音符类别 · . 附点 · T 三连音 · Q 删除 · 左右键移动（Shift ×10） · Enter 确认并下一行</footer>
  </>;
}

function CropPreview({image,bbox,event,imageBounds}:{image:string;bbox:XYXY|null;event:LocEvent;imageBounds:XYXY}) {
  if(!bbox||!image)return null;
  return <svg className="rhythm-preview" viewBox={`${bbox[0]} ${bbox[1]} ${bbox[2]-bbox[0]} ${bbox[3]-bbox[1]}`} aria-label="选中事件的小节上下文"><image href={image} x={imageBounds[0]} y={imageBounds[1]} width={imageBounds[2]-imageBounds[0]} height={imageBounds[3]-imageBounds[1]}/>
    {event.bbox&&<rect x={event.bbox[0]} y={event.bbox[1]} width={event.bbox[2]-event.bbox[0]} height={event.bbox[3]-event.bbox[1]} fill="none" stroke={color(event)} vectorEffect="non-scaling-stroke"/>}</svg>;
}
