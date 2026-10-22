import {need,regions,TAXONOMY} from './annotation.mjs';
import {transaction} from './datasets.mjs';
import {pageRecord,pageValue} from './pages.mjs';
import {regionReview} from './crop-rules.mjs';
export function registerRegionReview(router,{pool}){
 router.post('/pages/:pageId/regions/:regionId/review',async(req,res)=>res.json(await transaction(pool,async c=>{
  const p=await pageRecord(c,req.params.pageId,true),status=req.body.status;need(req.body.version===p.version,'页面版本冲突，请保留草稿',409);need(['draft','needs_adjustment','confirmed'].includes(status),'复核状态无效');const scope=status==='confirmed'?'data:confirm':'data:write';need(req.identity.scopes.includes(scope),'复核权限不足',403);if(status==='confirmed')need(req.body.acknowledged===true,'确认区域需明确检查');const box=p.boxes.find(b=>b.id===req.params.regionId);need(box,'区域不存在',404);if(status==='confirmed'){need(p.coordinate&&p.annotation_format===TAXONOMY&&box.classKey,'历史未归类区域不能确认',409);need(['system','chord_marks','title','performer','time_signature','key_signature','tempo','capo'].includes(box.classKey)||box.parentSystemId,'子区域必须选择所属谱行');regions(p.boxes,p.coordinate.working.width,p.coordinate.working.height,{pageType:p.page_type,taxonomyVersion:p.annotation_version||TAXONOMY});}
  const boxes=p.boxes.map(b=>({...b,reviewStatus:b.id===box.id?status:regionReview(b,p.status)}));const row=(await c.query("UPDATE omr_images SET boxes=$1,status='draft',version=version+1,updated_at=now() WHERE id=$2 RETURNING *",[JSON.stringify(boxes),p.id])).rows[0];row.dataset_id=p.dataset_id;return pageValue(row);
 })));
 router.post('/pages/:pageId/regions/:regionId/restore',async(req,res)=>res.json(await transaction(pool,async c=>{
  const p=await pageRecord(c,req.params.pageId,true);need(req.body.version===p.version,'页面版本冲突，请保留草稿',409);const box=p.deleted_boxes.find(b=>b.id===req.params.regionId);need(box,'已删除区域不存在',404);need(!p.boxes.some(b=>b.id===box.id),'区域ID已存在',409);const boxes=regions([...p.boxes,{...box,reviewStatus:'draft'}],p.coordinate.working.width,p.coordinate.working.height,{pageType:p.page_type,taxonomyVersion:p.annotation_version||TAXONOMY});const row=(await c.query("UPDATE omr_images SET boxes=$1,deleted_boxes=$2,status='draft',version=version+1,updated_at=now() WHERE id=$3 RETURNING *",[JSON.stringify(boxes),JSON.stringify(p.deleted_boxes.filter(b=>b.id!==box.id)),p.id])).rows[0];row.dataset_id=p.dataset_id;return pageValue(row);
 })));
}
