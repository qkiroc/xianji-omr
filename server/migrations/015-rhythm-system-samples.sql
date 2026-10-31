-- compatibility: expand
ALTER TABLE omr_loc_records ADD COLUMN superseded_at timestamptz;
CREATE INDEX omr_loc_active_records ON omr_loc_records(dataset_id,created_at DESC,id DESC) WHERE superseded_at IS NULL;

-- Preserve the complete page records as historical backups. Existing snapshots
-- are immutable and continue to contain their original page-level annotations.
WITH grouped AS (
  SELECT r.id parent_id,
    CASE WHEN region->>'systemId' IS NOT NULL THEN 'system:'||(region->>'systemId') ELSE 'region:'||(region->>'id') END sample_id,
    min(region->>'pageId') page_id,
    jsonb_agg(region ORDER BY ord) regions,
    min((region->'bbox'->>0)::int) x1,min((region->'bbox'->>1)::int) y1,
    max((region->'bbox'->>2)::int) x2,max((region->'bbox'->>3)::int) y2
  FROM omr_loc_records r JOIN omr_loc_datasets d ON d.id=r.dataset_id
  CROSS JOIN LATERAL jsonb_array_elements(r.geometry->'regions') WITH ORDINALITY a(region,ord)
  WHERE d.task='rhythm' AND r.geometry->>'schemaVersion'='omr-rhythm-v1'
    AND NOT (r.geometry ? 'sample') AND r.superseded_at IS NULL
  GROUP BY r.id,CASE WHEN region->>'systemId' IS NOT NULL THEN 'system:'||(region->>'systemId') ELSE 'region:'||(region->>'id') END
), numbered AS (
  SELECT *,row_number() OVER(PARTITION BY parent_id ORDER BY y1,x1,sample_id) line_index FROM grouped
), samples AS (
  SELECT *,jsonb_build_object('unit','system','id',sample_id,'pageId',page_id,'index',line_index,
    'bbox',jsonb_build_array(x1,y1,x2,y2)) sample FROM numbered
), inserted AS (
  INSERT INTO omr_loc_records(id,dataset_id,corpus_id,corpus_revision,source_fingerprint,input_checksum,original,geometry,
    title,group_key,split,source,version,status,confirmed_at,first_labeled_at,created_at,updated_at)
  SELECT gen_random_uuid(),r.dataset_id,'layout-system:'||s.page_id||':'||s.sample_id,r.corpus_revision,
    r.source_fingerprint,r.input_checksum,
    r.original||jsonb_build_object('regions',s.regions,'sample',s.sample,'previousPageRecordId',r.id),
    r.geometry||jsonb_build_object('regions',s.regions,'sample',s.sample,'measures',
      COALESCE((SELECT jsonb_agg(m) FROM jsonb_array_elements(r.geometry->'measures') m
        WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(s.regions) region WHERE region->>'id'=m->>'regionId')),'[]'::jsonb)),
    left(r.title,170)||' · 第 '||s.line_index||' 行',r.group_key,r.split,r.source,r.version,r.status,r.confirmed_at,r.first_labeled_at,
    statement_timestamp()-(row_number() OVER(ORDER BY r.created_at DESC,r.id,s.line_index)*interval '1 microsecond'),r.updated_at
  FROM samples s JOIN omr_loc_records r ON r.id=s.parent_id
  RETURNING id,original
), attachments AS (
  INSERT INTO omr_loc_record_pages(record_id,local_page_id,source_page_id,source_sha,pixel_sha,coordinate_mapping)
  SELECT n.id,p.local_page_id,p.source_page_id,p.source_sha,p.pixel_sha,p.coordinate_mapping
  FROM inserted n JOIN omr_loc_record_pages p ON p.record_id=(n.original->>'previousPageRecordId')::uuid
)
UPDATE omr_loc_records SET superseded_at=now(),version=version+1
WHERE id IN(SELECT (original->>'previousPageRecordId')::uuid FROM inserted);
