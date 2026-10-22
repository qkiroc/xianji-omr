import {createHash} from 'node:crypto';
export const TAXONOMY='layout-v1';
export const CATEGORIES=[['system','完整谱行','#6d5eea'],['guitar','六线谱','#228dce'],['melody','简谱','#d89425'],['lyrics','歌词','#26a17b'],['chord_marks','和弦/标记','#dd6689'],['staff_notation','五线谱','#777bc6'],['other_tab','其他谱表','#89929e']].map(([key,name,color],id)=>({id,cocoId:id+1,key,name,color}));
export const digest=data=>createHash('sha256').update(data).digest('hex');
export const stable=o=>Array.isArray(o)?'['+o.map(stable).join(',')+']':o&&typeof o==='object'?'{'+Object.keys(o).filter(k=>o[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(o[k])).join(',')+'}':JSON.stringify(o);
export class Problem extends Error{constructor(message,status=400,details){super(message);this.status=status;this.details=details}}
export const need=(ok,message,status=400,details)=>{if(!ok)throw new Problem(message,status,details)};
export const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function regions(boxes,w,h,{confirm=false,pageType='music'}={}){
 need(Array.isArray(boxes)&&boxes.length<=5000,'最多5000个标注框');need(['music','negative'].includes(pageType),'页类型无效');
 const ids=new Set;
 const result=boxes.map(b=>{need(b&&typeof b.id==='string'&&b.id.length>0&&b.id.length<=100&&!ids.has(b.id),'框ID无效或重复');ids.add(b.id);need(['x','y','width','height'].every(k=>Number.isSafeInteger(b[k]))&&b.x>=0&&b.y>=0&&b.width>0&&b.height>0&&b.x+b.width<=w&&b.y+b.height<=h,'框坐标超出工作图像或不是整数');need(b.classKey===null||CATEGORIES.some(c=>c.key===b.classKey),'请选择七类之一（历史框可暂未归类）');need(b.parentSystemId===null||typeof b.parentSystemId==='string','父谱行ID无效');need(Number.isSafeInteger(b.readingOrder)&&b.readingOrder>=0,'阅读顺序必须是非负整数');return{id:b.id,classKey:b.classKey,parentSystemId:b.parentSystemId,readingOrder:b.readingOrder,x:b.x,y:b.y,width:b.width,height:b.height}});
 for(const b of result){if(b.classKey==='system')need(b.parentSystemId===null,'完整谱行不能有父框');if(b.parentSystemId!==null){const p=result.find(r=>r.id===b.parentSystemId);need(p&&p.classKey==='system'&&p.id!==b.id,'父框必须是本页完整谱行');need(b.x>=p.x&&b.y>=p.y&&b.x+b.width<=p.x+p.width&&b.y+b.height<=p.y+p.height,'父谱行必须包含子区域')}if(confirm){need(b.classKey!==null,'历史未归类框不能确认');if(!['system','chord_marks'].includes(b.classKey))need(b.parentSystemId!==null,'子区域必须选择所属谱行')}}
 if(confirm)need(pageType==='negative'?result.length===0:result.length>0,'音乐页必须有区域；负样本必须无框并明确确认');
 return result;
}
export function canonicalAnnotation(boxes,pageType){const shape=b=>({classKey:b.classKey,x:b.x,y:b.y,width:b.width,height:b.height,readingOrder:b.readingOrder});const ordered=a=>a.sort((a,b)=>stable(a).localeCompare(stable(b),'en'));return stable({pageType,roots:ordered(boxes.filter(b=>b.parentSystemId===null).map(b=>({...shape(b),children:ordered(boxes.filter(c=>c.parentSystemId===b.id).map(shape))})))})}
