-- compatibility: expand
CREATE TABLE omr_images (
 id uuid PRIMARY KEY,
 object_key text NOT NULL UNIQUE,
 original_name text NOT NULL,
 mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
 width integer NOT NULL CHECK (width BETWEEN 1 AND 20000),
 height integer NOT NULL CHECK (height BETWEEN 1 AND 20000),
 checksum char(64) NOT NULL,
 boxes jsonb NOT NULL DEFAULT '[]'::jsonb,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE omr_sessions (token_hash char(64) PRIMARY KEY, credential_hash char(64) NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX omr_images_updated ON omr_images(updated_at DESC);
