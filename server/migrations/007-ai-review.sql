-- compatibility: expand
-- Only widen the CHECK domain; retain all rows, IDs, versions and review states.
DO $$
BEGIN
  ALTER TABLE omr_images DROP CONSTRAINT omr_images_status_check;
  ALTER TABLE omr_images ADD CONSTRAINT omr_images_status_check CHECK(status IN ('draft','ai_reviewed','confirmed'));
END
$$;
