-- compatibility: expand
CREATE TABLE omr_training_runs (
 id uuid PRIMARY KEY, name text NOT NULL, owner_grant uuid,
 status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','running','exporting','completed','failed','cancelled')),
 fingerprint text NOT NULL CHECK(length(fingerprint)=64), categories jsonb NOT NULL,
 config jsonb NOT NULL, dataset_summary jsonb NOT NULL,
 last_seq integer NOT NULL DEFAULT 0, last_epoch integer NOT NULL DEFAULT 0,
 metrics jsonb NOT NULL DEFAULT '{}', error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 heartbeat_at timestamptz, completed_at timestamptz
);
CREATE TABLE omr_training_events (
 run_id uuid NOT NULL REFERENCES omr_training_runs(id), seq integer NOT NULL,
 kind text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,seq)
);
CREATE TABLE omr_training_artifacts (
 run_id uuid NOT NULL REFERENCES omr_training_runs(id), kind text NOT NULL,
 object_key text NOT NULL UNIQUE, checksum text NOT NULL, bytes bigint NOT NULL,
 mime text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,kind)
);
CREATE TABLE omr_inference_workers (
 id uuid PRIMARY KEY, owner_grant uuid NOT NULL, name text NOT NULL, device text NOT NULL,
 heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE omr_predictions (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES omr_training_runs(id), request_key uuid NOT NULL UNIQUE, request_checksum text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
 image_key text NOT NULL UNIQUE, image_checksum text NOT NULL, image_bytes integer NOT NULL,
 width integer NOT NULL, height integer NOT NULL, confidence double precision NOT NULL,
 iou double precision NOT NULL, boxes jsonb, elapsed_ms double precision, error text,
 worker_id uuid REFERENCES omr_inference_workers(id), claim_hash text, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX omr_training_runs_created ON omr_training_runs(created_at DESC);
CREATE INDEX omr_predictions_queue ON omr_predictions(status,created_at);
