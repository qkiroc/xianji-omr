-- compatibility: expand
ALTER TABLE omr_loc_datasets ADD COLUMN task text NOT NULL DEFAULT 'geometry' CHECK(task IN ('geometry','rhythm'));
ALTER TABLE omr_loc_datasets ADD COLUMN source_dataset_id uuid REFERENCES omr_datasets(id);
ALTER TABLE omr_loc_records ADD COLUMN first_labeled_at timestamptz;
CREATE INDEX omr_loc_first_label ON omr_loc_records(dataset_id,first_labeled_at);
