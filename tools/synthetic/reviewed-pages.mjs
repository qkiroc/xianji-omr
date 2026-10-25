import {createHash} from 'node:crypto';
import {annotationHash,canonical} from './reconcile-completed.mjs';
export function reviewedFingerprint(value){const i=value.image;return{pageId:i.id,datasetId:i.datasetId,songId:i.songId||null,checksum:i.checksum,width:i.width,height:i.height,version:i.version,status:i.status,source:i.source||'',annotationSha256:annotationHash(value),deletedBoxesSha256:createHash('sha256').update(canonical(value.deletedBoxes||[])).digest('hex')};}
export function assertReviewedPage(expected,value){const actual=reviewedFingerprint(value);if(canonical(expected)!==canonical(actual)){const fields=Object.keys(actual).filter(k=>canonical(expected?.[k])!==canonical(actual[k]));throw Object.assign(Error('Page changed since geometry review; refusing resolution'),{code:'REVIEW_CHANGED',pageId:actual.pageId,fields});}return actual;}
export function approveReviewedRemoval(old,value,expected,reviewId){assertReviewedPage(expected,value);if(!reviewId)throw Error('A review ID is required');return{...old,version:value.image.version,status:value.image.status,boxCount:value.boxes.length,removalApproval:{reviewId,fingerprint:expected}};}
export function hasReviewedRemoval(old,value){return !!old.removalApproval?.reviewId&&canonical(old.removalApproval.fingerprint)===canonical(reviewedFingerprint(value));}
export function validateReviewedGeometry(page){const boxes=page.annotation?.boxes||page.boxes;
 if(boxes.some(b=>b.classKey==='key_signature'&&b.metadata?.value?.kind==='original'))throw Error('Original key must not be annotated');
 for(const m of boxes.filter(b=>b.classKey==='melody'))for(const l of boxes.filter(b=>b.classKey==='lyrics'&&b.parentSystemId===m.parentSystemId))if(Math.min(m.x+m.width,l.x+l.width)>Math.max(m.x,l.x)&&Math.min(m.y+m.height,l.y+l.height)>Math.max(m.y,l.y))throw Error('Melody and lyric crops overlap');
 return true;
}
