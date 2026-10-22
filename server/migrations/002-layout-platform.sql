-- compatibility: expand
CREATE TABLE omr_datasets (
 id uuid PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
 task text NOT NULL DEFAULT 'layout' CHECK(task='layout'), taxonomy_version text NOT NULL DEFAULT 'layout-v1',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE omr_songs (
 id uuid PRIMARY KEY, dataset_id uuid NOT NULL REFERENCES omr_datasets(id), name text NOT NULL,
 song_group_key text NOT NULL, split text NOT NULL CHECK(split IN ('train','val','test')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO omr_datasets(id,name,description) VALUES('00000000-0000-4000-8000-000000000001','历史未归类','旧版图片与无类别框：保留为草稿，人工整理后才能确认');
INSERT INTO omr_songs(id,dataset_id,name,song_group_key,split) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','待整理曲目','legacy-unassigned','train');
ALTER TABLE omr_images ADD COLUMN song_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000002' REFERENCES omr_songs(id);
ALTER TABLE omr_images ADD COLUMN page_order integer NOT NULL DEFAULT 1 CHECK(page_order>0);
ALTER TABLE omr_images ADD COLUMN annotation_format text NOT NULL DEFAULT 'legacy' CHECK(annotation_format IN ('legacy','layout-v1'));
ALTER TABLE omr_images ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed'));
ALTER TABLE omr_images ADD COLUMN page_type text NOT NULL DEFAULT 'music' CHECK(page_type IN ('music','negative'));
ALTER TABLE omr_images ADD COLUMN coordinate jsonb;
ALTER TABLE omr_images ADD COLUMN legacy_boxes jsonb;
CREATE INDEX omr_images_song ON omr_images(song_id,page_order);
CREATE INDEX omr_songs_dataset ON omr_songs(dataset_id,song_group_key);
CREATE TABLE omr_snapshots (
 id uuid PRIMARY KEY, dataset_id uuid NOT NULL REFERENCES omr_datasets(id),
 frozen jsonb NOT NULL, status text NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','ready','failed')),
 manifest jsonb, artifacts jsonb, error text, progress integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE FUNCTION omr_protect_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.frozen IS DISTINCT FROM OLD.frozen OR NEW.dataset_id IS DISTINCT FROM OLD.dataset_id THEN
  RAISE EXCEPTION 'snapshot source is immutable';
 END IF;
 IF OLD.status='ready' THEN RAISE EXCEPTION 'ready snapshot is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER omr_snapshot_immutable BEFORE UPDATE ON omr_snapshots FOR EACH ROW EXECUTE FUNCTION omr_protect_snapshot();
