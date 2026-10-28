-- compatibility: expand
CREATE TABLE omr_time_datasets (
 id uuid PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
 source_dataset_id uuid REFERENCES omr_datasets(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE omr_time_records (
 sequence bigint GENERATED ALWAYS AS IDENTITY, id uuid PRIMARY KEY, dataset_id uuid NOT NULL REFERENCES omr_time_datasets(id),
 source_page_id uuid NOT NULL REFERENCES omr_images(id),
 source_box_id text NOT NULL, source_checksum text NOT NULL, rectangle jsonb NOT NULL, source jsonb NOT NULL,
 song_group_key text NOT NULL, split text NOT NULL CHECK(split IN ('train','val','test')),
 numerator integer CHECK(numerator BETWEEN 1 AND 32), denominator integer CHECK(denominator IN (1,2,4,8,16,32,64)),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed')),
 first_labeled_at timestamptz, label_time_estimated boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status <> 'confirmed' OR (numerator IS NOT NULL AND denominator IS NOT NULL)),
 UNIQUE(dataset_id,source_page_id,source_box_id)
);
CREATE INDEX omr_time_records_queue ON omr_time_records(dataset_id,sequence,id);
CREATE INDEX omr_time_records_pending ON omr_time_records(dataset_id,sequence,id) WHERE status='draft';
CREATE INDEX omr_time_records_source ON omr_time_records(source_page_id);
CREATE INDEX omr_time_records_first_label ON omr_time_records(dataset_id,first_labeled_at) WHERE first_labeled_at IS NOT NULL;
