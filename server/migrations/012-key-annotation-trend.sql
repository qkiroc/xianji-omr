-- compatibility: expand
ALTER TABLE omr_key_records ADD COLUMN first_labeled_at timestamptz;
ALTER TABLE omr_key_records ADD COLUMN label_time_estimated boolean NOT NULL DEFAULT false;
UPDATE omr_key_records SET first_labeled_at=updated_at,label_time_estimated=true WHERE status='confirmed';
CREATE INDEX omr_key_records_first_label ON omr_key_records(dataset_id,first_labeled_at) WHERE first_labeled_at IS NOT NULL;