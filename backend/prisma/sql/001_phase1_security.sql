-- =============================================================================
-- Phase 1: security hardening + Supabase Storage for report photos
--
-- Safe to run more than once. It does not delete, rewrite or move any rows.
-- Apply with:   npm run db:phase1
-- (or paste into Supabase Dashboard > SQL Editor and run)
--
-- Why: this app's backend talks to Postgres directly as the `postgres` role
-- (which has BYPASSRLS and owns every table), and enforces all Reporter /
-- Technician / Coordinator / Admin rules in the API. Supabase ALSO exposes
-- every `public` table through its Data API (PostgREST) to the `anon` and
-- `authenticated` roles using the project's anon key, which is public by
-- design. Before this script, those roles had full read/write/delete on every
-- table (including User.passwordHash) and RLS was off everywhere.
--
-- After this script, the Data API can't reach the app tables at all; the
-- backend is unaffected.
-- =============================================================================

BEGIN;

-- 1) Session versioning: lets the backend end a user's sessions immediately
--    (password change/reset, role change, deactivation, sign out everywhere).
ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0;

-- 2) Row Level Security on every table in `public`, plus an explicit
--    RESTRICTIVE deny for the Data API roles. A restrictive policy is ANDed
--    with all others, so even a permissive policy added by mistake later
--    can't open these tables to anon/authenticated. The backend (postgres,
--    BYPASSRLS) is not affected.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS "deny_data_api" ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY "deny_data_api" ON public.%I AS RESTRICTIVE FOR ALL '
      'TO anon, authenticated USING (false) WITH CHECK (false)',
      t.relname
    );
  END LOOP;
END $$;

-- 3) Remove the Data API roles' privileges on existing objects...
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- ...and on objects the backend (postgres) creates in the future.
-- Note: tables added later still need RLS enabled. Re-run this script after
-- any schema change; it's idempotent. `npm run db:check-security` reports gaps.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 4) Private bucket for report and work photos.
--    The size and type limits are also enforced by Supabase itself, in
--    addition to the backend's own checks. If you change
--    SUPABASE_STORAGE_BUCKET, change the id below to match.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-photos',
  'report-photos',
  false,
  5242880, -- 5 MB, same as the API limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 5) Storage access: only the backend's service-role key (which bypasses RLS)
--    may upload, read, list or delete objects in this bucket. App users view
--    photos only through short-lived signed URLs that the backend issues after
--    its own role checks. This restrictive policy blocks anon/authenticated
--    from the bucket even if a broader storage policy is added later. Other
--    buckets are not affected.
DROP POLICY IF EXISTS "report_photos_backend_only" ON storage.objects;
CREATE POLICY "report_photos_backend_only" ON storage.objects
  AS RESTRICTIVE FOR ALL
  TO anon, authenticated
  USING (bucket_id <> 'report-photos')
  WITH CHECK (bucket_id <> 'report-photos');

COMMIT;
