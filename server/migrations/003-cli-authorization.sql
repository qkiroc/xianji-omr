-- compatibility: expand
CREATE TABLE omr_cli_auth_requests (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'), client_name text NOT NULL CHECK(length(client_name) BETWEEN 1 AND 80),
 device_description text NOT NULL CHECK(length(device_description)<=160), redirect_uri text NOT NULL,
 state text NOT NULL CHECK(state ~ '^[a-f0-9]{64}$'), challenge text NOT NULL CHECK(challenge ~ '^[A-Za-z0-9_-]{43}$'), scopes text[] NOT NULL CHECK(cardinality(scopes)>0 AND scopes <@ ARRAY['data:read','data:write','data:confirm']::text[]),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','consumed','expired')),
 user_identity text, credential_hash text, code_hash text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 code_expires_at timestamptz, failed_exchanges integer NOT NULL DEFAULT 0
);
CREATE INDEX omr_cli_requests_expiry ON omr_cli_auth_requests(expires_at);
CREATE TABLE omr_cli_grants (
 id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'), user_identity text NOT NULL, credential_hash text NOT NULL,
 client_name text NOT NULL, device_description text NOT NULL, scopes text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 revoked_at timestamptz, last_used_at timestamptz
);
CREATE INDEX omr_cli_grants_expiry ON omr_cli_grants(expires_at);
