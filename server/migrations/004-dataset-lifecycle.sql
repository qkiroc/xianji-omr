-- compatibility: expand
ALTER TABLE omr_datasets ADD COLUMN deleted_at timestamptz;
ALTER TABLE omr_songs ADD COLUMN deleted_at timestamptz;
ALTER TABLE omr_images ADD COLUMN deleted_at timestamptz;
ALTER TABLE omr_images ADD COLUMN source text NOT NULL DEFAULT '';
ALTER TABLE omr_images ADD COLUMN annotation_version text NOT NULL DEFAULT 'layout-v1' CHECK(annotation_version IN ('layout-v1','layout-v2'));
CREATE INDEX omr_images_active_order ON omr_images(created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX omr_images_deleted ON omr_images(song_id,deleted_at);
ALTER TABLE omr_images ADD COLUMN deleted_boxes jsonb NOT NULL DEFAULT '[]'::jsonb;
