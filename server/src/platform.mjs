import express from 'express';
import {CATEGORIES,TAXONOMY,need,ID} from './annotation.mjs';
import {registerDatasets} from './datasets.mjs';
import {registerPages} from './pages.mjs';
import {createExporter} from './exporter.mjs';
import {pipeline} from 'node:stream/promises';
export function createPlatform(deps){const router=express.Router(),exporter=createExporter(deps),{pool,storage}=deps;router.exporter=exporter;
 // Router-specific parser leaves image streams to the upload handler.
 router.use((req,res,next)=>{if(req.method==='POST'&&/^\/songs\/[^/]+\/pages$/.test(req.path))return next();express.json({limit:'2mb'})(req,res,next)});
 router.get('/taxonomy',(req,res)=>res.json({taxonomyVersion:TAXONOMY,categories:CATEGORIES}));registerDatasets(router,deps);registerPages(router,deps);
 router.get('/datasets/:datasetId/snapshots',async(req,res)=>{need(ID.test(req.params.datasetId),'数据集ID无效');res.json((await pool.query('SELECT id,status,progress,error,created_at,completed_at,frozen,artifacts,manifest FROM omr_snapshots WHERE dataset_id=$1 ORDER BY created_at DESC LIMIT 30',[req.params.datasetId])).rows.map(r=>({id:r.id,status:r.status,progress:r.progress,error:r.error,createdAt:r.created_at,stats:r.frozen.stats,warnings:r.frozen.warnings,datasetFingerprint:r.manifest?.datasetFingerprint,artifacts:r.artifacts?Object.fromEntries(Object.entries(r.artifacts).map(([k,v])=>[k,{bytes:v.bytes,checksum:v.checksum}])):null}))) });
 router.post('/datasets/:datasetId/snapshots',async(req,res)=>res.status(202).json({id:await exporter.launch(req.params.datasetId)}));
 router.post('/snapshots/:snapshotId/retry',async(req,res)=>{need(ID.test(req.params.snapshotId),'快照ID无效');res.status(202).json({id:await exporter.launch(null,req.params.snapshotId)})});
 router.get('/snapshots/:snapshotId/:kind',async(req,res)=>{need(ID.test(req.params.snapshotId)&&['detection','crops'].includes(req.params.kind),'下载标识无效');const r=(await pool.query('SELECT status,artifacts FROM omr_snapshots WHERE id=$1',[req.params.snapshotId])).rows[0];need(r?.status==='ready','快照尚未准备好，不能下载',409);const asset=r.artifacts[req.params.kind],stream=await storage.getStream(asset.key);res.type('application/zip').set({'Content-Disposition':`attachment; filename="${req.params.snapshotId}-${req.params.kind}.zip"`,'Content-Length':String(asset.bytes),'X-Checksum-Sha256':asset.checksum});await pipeline(stream,res)});
 return router;
}
