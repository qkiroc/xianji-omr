-- compatibility: expand
CREATE TABLE omr_loc_datasets(id uuid PRIMARY KEY,name text NOT NULL,description text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE omr_loc_records(id uuid PRIMARY KEY,dataset_id uuid NOT NULL REFERENCES omr_loc_datasets(id),corpus_id text NOT NULL,corpus_revision integer NOT NULL,source_fingerprint text NOT NULL,input_checksum text NOT NULL,original jsonb NOT NULL,geometry jsonb NOT NULL,title text NOT NULL,group_key text NOT NULL,split text NOT NULL CHECK(split IN ('train','val','test')),source text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed')),confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(dataset_id,corpus_id,corpus_revision,source_fingerprint));
CREATE TABLE omr_loc_record_pages(record_id uuid NOT NULL REFERENCES omr_loc_records(id),local_page_id text NOT NULL,source_page_id uuid NOT NULL REFERENCES omr_images(id),source_sha text NOT NULL,pixel_sha text,coordinate_mapping jsonb NOT NULL,PRIMARY KEY(record_id,local_page_id));
CREATE INDEX omr_loc_pages_source ON omr_loc_record_pages(source_page_id);
CREATE INDEX omr_loc_records_list ON omr_loc_records(dataset_id,created_at DESC,id DESC);
CREATE TABLE omr_loc_snapshots(id uuid PRIMARY KEY,dataset_id uuid NOT NULL REFERENCES omr_loc_datasets(id),frozen jsonb NOT NULL,fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION omr_loc_frozen_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'localization snapshots are immutable'; END $$;
CREATE TRIGGER omr_loc_frozen_guard BEFORE UPDATE OR DELETE ON omr_loc_snapshots FOR EACH ROW EXECUTE FUNCTION omr_loc_frozen_immutable();

CREATE INDEX omr_loc_record_pages_sha ON omr_loc_record_pages(source_sha);
