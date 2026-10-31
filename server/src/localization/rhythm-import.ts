import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Geometry, RhythmRegion, SourcePage } from "../../../shared/localization.ts";
import { originalBounds } from "../../../shared/localization-edit.ts";
import { datasetRecord } from "../datasets.ts";
import { fingerprint, validateGeometry } from "./geometry.ts";
import { rhythmSamples } from "../../../shared/rhythm-samples.ts";

// Each sample contains one system and references the immutable original page.
// Rectangles remain in original coordinates. Sync never overwrites human edits.
export async function importRhythmPages(c: PoolClient, datasetId: string, sourceId: string) {
  await datasetRecord(c,sourceId,{lock:true});
  const rows = (await c.query(`SELECT i.*,s.name song_name,s.song_group_key,s.split
    FROM omr_images i JOIN omr_songs s ON s.id=i.song_id
    WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.deleted_at IS NULL
    AND i.status='confirmed' AND i.annotation_format<>'legacy'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.boxes) b WHERE b->>'classKey' IN ('guitar','melody','lyrics'))
    ORDER BY s.created_at,s.id,i.page_order,i.id`,[sourceId])).rows;
  let imported = 0;
  const existing = new Set((await c.query('SELECT corpus_id FROM omr_loc_records WHERE dataset_id=$1',[datasetId])).rows.map(r => r.corpus_id));
  const pending: any[] = [];
  for (const row of rows) {
    const page: SourcePage = {localPageId:row.id,sourcePageId:row.id,sourceSha:row.checksum,pixelSha:null,
      width:row.width,height:row.height,mapping:[[1,0,0],[0,1,0],[0,0,1]]};
    const regions: RhythmRegion[] = row.boxes.filter((b:any) => ['guitar','melody','lyrics'].includes(b.classKey))
      .sort((a:any,b:any) => a.y-b.y || a.x-b.x || a.id.localeCompare(b.id)).map((b:any) => ({
        id:b.id,pageId:row.id,systemId:b.parentSystemId ?? null,track:b.classKey,
        bbox:originalBounds(b,row.coordinate?.orientation ?? 1,row.width,row.height),
      }));
    for(const group of rhythmSamples(regions)) {
    const corpusId = 'layout-system:'+row.id+':'+group.sample.id;
    if (existing.has(corpusId)) continue;
    const geometry: Geometry = validateGeometry({schemaVersion:'omr-rhythm-v1',pages:[page],sample:group.sample,regions:group.regions,measures:[]},[page]);
    const original = {sourceDatasetId:sourceId,pageId:row.id,songId:row.song_id,songName:row.song_name,
      pageOrder:row.page_order,pageName:row.original_name,layoutVersion:row.version,regions:group.regions,sample:group.sample};
    const rid = randomUUID();
    pending.push({id:rid,corpus_id:corpusId,source_fingerprint:fingerprint({sha:page.sourceSha}),input_checksum:fingerprint(original),
      original,geometry,title:row.song_name+' · 第 '+row.page_order+' 页 · 第 '+group.sample.index+' 行',group_key:row.song_group_key,split:row.split});
    }
  }
  // Batch both tables: thousands of confirmed pages must not require thousands
  // of individual round trips to RDS.
  const createdAt = new Date().toISOString();
  for (let offset=0;offset<pending.length;offset+=200) {
    const inserted = await c.query(`INSERT INTO omr_loc_records(id,dataset_id,corpus_id,corpus_revision,source_fingerprint,input_checksum,
      original,geometry,title,group_key,split,source,created_at)
      SELECT x.id,$1,x.corpus_id,1,x.source_fingerprint,x.input_checksum,x.original,x.geometry,x.title,x.group_key,x.split,'layout-confirmed',
        $3::timestamptz-(($4::int+x.position)*interval '1 microsecond')
      FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,corpus_id text,source_fingerprint text,input_checksum text,original jsonb,geometry jsonb,title text,group_key text,split text,position int)
      ON CONFLICT(dataset_id,corpus_id,corpus_revision,source_fingerprint) DO NOTHING RETURNING id`,[datasetId,JSON.stringify(pending.slice(offset,offset+200).map((r,i)=>({...r,position:i}))),createdAt,offset]);
    if (inserted.rowCount) await c.query(`INSERT INTO omr_loc_record_pages(record_id,local_page_id,source_page_id,source_sha,pixel_sha,coordinate_mapping)
      SELECT r.id,p->>'localPageId',(p->>'sourcePageId')::uuid,p->>'sourceSha',p->>'pixelSha',p->'mapping'
      FROM omr_loc_records r CROSS JOIN LATERAL jsonb_array_elements(r.geometry->'pages') p WHERE r.id=ANY($1::uuid[])`,[inserted.rows.map(r=>r.id)]);
    imported+=inserted.rowCount ?? 0;
  }
  await c.query('UPDATE omr_loc_datasets SET updated_at=now() WHERE id=$1',[datasetId]);
  return imported;
}
