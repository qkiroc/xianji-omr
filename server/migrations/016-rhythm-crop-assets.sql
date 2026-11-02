-- compatibility: expand
ALTER TABLE omr_loc_records ADD COLUMN crop_image jsonb;
ALTER TABLE omr_loc_datasets ADD COLUMN import_key text UNIQUE;
CREATE TABLE omr_loc_crop_assets (
  record_id uuid PRIMARY KEY REFERENCES omr_loc_records(id),
  object_key text NOT NULL UNIQUE,
  checksum text NOT NULL,
  width integer NOT NULL CHECK(width > 0),
  height integer NOT NULL CHECK(height > 0)
);
