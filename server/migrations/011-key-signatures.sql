-- compatibility: expand
CREATE TABLE omr_key_datasets (
 id uuid PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
 source_dataset_id uuid REFERENCES omr_datasets(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE omr_key_records (
 sequence bigint GENERATED ALWAYS AS IDENTITY, id uuid PRIMARY KEY, dataset_id uuid NOT NULL REFERENCES omr_key_datasets(id),
 source_page_id uuid NOT NULL REFERENCES omr_images(id),
 source_box_id text NOT NULL, source_checksum text NOT NULL, rectangle jsonb NOT NULL, source jsonb NOT NULL,
 song_group_key text NOT NULL, split text NOT NULL CHECK(split IN ('train','val','test')),
 tonic text CHECK(tonic ~ '^[CDEFGAB][b#]?$'), kind text CHECK(kind IN ('original','play')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status <> 'confirmed' OR (tonic IS NOT NULL AND kind IS NOT NULL)),
 UNIQUE(dataset_id,source_page_id,source_box_id)
);
CREATE INDEX omr_key_records_queue ON omr_key_records(dataset_id,sequence,id);
CREATE INDEX omr_key_records_pending ON omr_key_records(dataset_id,sequence,id) WHERE status='draft';
CREATE INDEX omr_key_records_source ON omr_key_records(source_page_id);