-- compatibility: expand
-- Only relax the request scope check. Existing grants and annotation data are unchanged.
DO $$
BEGIN
 ALTER TABLE omr_cli_auth_requests DROP CONSTRAINT omr_cli_auth_requests_scopes_check;
 ALTER TABLE omr_cli_auth_requests ADD CONSTRAINT omr_cli_auth_requests_scopes_check CHECK (
  cardinality(scopes)>0 AND scopes <@ ARRAY['data:read','data:write','data:confirm','platform:deploy']::text[]
 );
END
$$;
