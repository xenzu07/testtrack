-- =============================================================================
-- Phase 3: technician skills survey and roles
--
-- Safe to run more than once. It does not change or delete any rows.
-- Apply with:   npm run db:phase3
--
-- The tables "TechnicianRole" and "TechnicianSurvey" and the column
-- "User"."surveyCompletedAt" already exist in the database (created earlier,
-- empty) and are now described in prisma/schema.prisma exactly as they are.
-- This script only adds the two indexes the feature's queries need:
--   - finding technicians qualified for a trade unit (job assignment)
--   - finding a technician's latest survey
-- =============================================================================

BEGIN;

-- create the tables only if this is a fresh database that never had them;
-- on the existing database these statements change nothing
CREATE TABLE IF NOT EXISTS public."TechnicianRole" (
  "userId"      text NOT NULL,
  "tradeUnitId" text NOT NULL,
  "score"       integer NOT NULL DEFAULT 0,
  "assignedAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TechnicianRole_pkey" PRIMARY KEY ("userId", "tradeUnitId"),
  CONSTRAINT "TechnicianRole_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "TechnicianRole_tradeUnitId_fkey" FOREIGN KEY ("tradeUnitId")
    REFERENCES public."TradeUnit"(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public."TechnicianSurvey" (
  "id"        text NOT NULL,
  "userId"    text NOT NULL,
  "answers"   jsonb NOT NULL,
  "results"   jsonb NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TechnicianSurvey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TechnicianSurvey_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);

ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "surveyCompletedAt" timestamp(3);

CREATE INDEX IF NOT EXISTS "TechnicianRole_tradeUnitId_idx"
  ON public."TechnicianRole" ("tradeUnitId");

CREATE INDEX IF NOT EXISTS "TechnicianSurvey_userId_createdAt_idx"
  ON public."TechnicianSurvey" ("userId", "createdAt");

-- keep the Phase 1 lockdown on these tables (no-ops if already applied)
ALTER TABLE public."TechnicianRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TechnicianSurvey" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api" ON public."TechnicianRole";
CREATE POLICY "deny_data_api" ON public."TechnicianRole" AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "deny_data_api" ON public."TechnicianSurvey";
CREATE POLICY "deny_data_api" ON public."TechnicianSurvey" AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public."TechnicianRole", public."TechnicianSurvey" FROM anon, authenticated;

COMMIT;
