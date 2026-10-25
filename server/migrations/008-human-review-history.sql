-- compatibility: expand
ALTER TABLE omr_images ADD COLUMN human_reviews jsonb NOT NULL DEFAULT '{}'::jsonb
 CHECK (jsonb_typeof(human_reviews)='object');

-- Historical pages have no separate confirmation timestamp. Keep this estimate
-- explicit; subsequent human confirmations replace the entry for that day.
UPDATE omr_images i
 SET human_reviews=jsonb_build_object(
   to_char(i.updated_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD'),
   jsonb_build_object('confirmedAt',i.updated_at,'estimated',true))
 FROM omr_songs s JOIN omr_datasets d ON d.id=s.dataset_id
 WHERE i.song_id=s.id AND i.status='confirmed' AND i.annotation_format<>'legacy'
   AND i.source NOT LIKE 'synthetic:%'
   AND i.deleted_at IS NULL AND s.deleted_at IS NULL AND d.deleted_at IS NULL;
