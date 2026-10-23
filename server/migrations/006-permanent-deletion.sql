-- compatibility: expand
CREATE TABLE omr_deletion_jobs(id uuid PRIMARY KEY,input jsonb NOT NULL,plan jsonb NOT NULL,status text NOT NULL CHECK(status IN ('planned','pending','failed','done')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX omr_deletion_pending ON omr_deletion_jobs(status,created_at);
CREATE OR REPLACE FUNCTION omr_loc_frozen_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' AND current_setting('omr.permanent_delete',true)='on' THEN RETURN OLD; END IF; RAISE EXCEPTION 'localization snapshots are immutable'; END $$;
