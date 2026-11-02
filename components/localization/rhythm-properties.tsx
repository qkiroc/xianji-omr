"use client";
import {Button,InputNumber,Select,Space} from "antd";
import type {LocEvent,RhythmLabel} from "../../shared/localization";
import {clientId} from "../../shared/client";
import {rhythmBeats,TUPLET_OPTIONS} from "../../shared/rhythm";

export function RhythmProperties({event,events,onChange,onGroup}:{event:LocEvent;events:LocEvent[];onChange:(label:RhythmLabel)=>void;onGroup:()=>void}) {
  const label=event.rhythm||{duration:null},beats=rhythmBeats(label),t=label.tuplet;
  const groups=[...new Map(events.filter(e=>e.rhythm?.tuplet?.groupId).map(e=>[e.rhythm!.tuplet!.groupId!,e.rhythm!.tuplet!])).entries()];
  const ratio=t?`${t.actual}:${t.normal}`:"";
  const options=TUPLET_OPTIONS.some(o=>o.value===ratio)?TUPLET_OPTIONS:[...TUPLET_OPTIONS,{value:ratio,label:`自定义（${ratio}）`}];
  const change=(values:Partial<RhythmLabel>)=>onChange({...label,...values});
  return <>
    <label>音符 / 休止符</label><Select aria-label="音符类型" value={label.kind||"note"} onChange={kind=>change({kind:kind==="rest"?"rest":undefined,...(kind==="rest"?{tie:undefined}:{})})} options={[{value:"note",label:"音符"},{value:"rest",label:"休止符"}]}/>
    <label>附点</label><Select aria-label="附点数量" value={label.dots||0} onChange={dots=>change({dots:(dots||undefined) as RhythmLabel["dots"]})} options={[{value:0,label:"无附点"},{value:1,label:"附点"},{value:2,label:"双附点"},{value:3,label:"三附点"}]}/>
    <label>连音</label><Select aria-label="连音比例" value={ratio} options={options} onChange={value=>{const [actual,normal]=value.split(":").map(Number);change({tuplet:value?{actual,normal,groupId:t?.groupId||clientId()}:undefined});}}/>
    <Space size="small"><InputNumber aria-label="连音实际份数" size="small" min={2} max={16} precision={0} value={t?.actual||3} onChange={actual=>{if(actual)change({tuplet:{actual,normal:t?.normal||2,groupId:t?.groupId||clientId()}});}}/>
      <span>:</span><InputNumber aria-label="连音正常份数" size="small" min={1} max={16} precision={0} value={t?.normal||2} onChange={normal=>{if(normal)change({tuplet:{actual:t?.actual||3,normal,groupId:t?.groupId||clientId()}});}}/></Space>
    {t&&<><label>连音分组</label><Select aria-label="连音分组" value={t.groupId||""} options={[{value:"",label:"单独标记比例"},...groups.map(([value,g],i)=>({value,label:`第 ${i+1} 组（${g.actual}:${g.normal}）`}))]} onChange={groupId=>change({tuplet:groupId?{...groups.find(([id])=>id===groupId)![1],groupId}:{actual:t.actual,normal:t.normal}})}/>
      <Button size="small" disabled={events.length-events.findIndex(e=>e.id===event.id)<t.actual} onClick={onGroup}>从此事件起标记 {t.actual} 连音</Button></>}
    <label>延音线</label><Select aria-label="延音线" disabled={label.kind==="rest"} value={label.tie||"none"} onChange={tie=>change({tie:(tie==="none"?undefined:tie) as RhythmLabel["tie"]})} options={[{value:"none",label:"无"},{value:"start",label:"起点"},{value:"continue",label:"中间（接入并延续）"},{value:"stop",label:"终点"}]}/>
    {beats&&<p className="muted small">时值：{beats.numerator}{beats.denominator===1?"":"/"+beats.denominator} 拍（四分音符为 1 拍）</p>}
  </>;
}
