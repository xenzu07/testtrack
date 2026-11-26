-- =============================================================================
-- Phase 5: priority scoring, duplicate detection, coordinator review/override
--
-- Safe to run more than once. No existing rows are deleted or rewritten,
-- except setting the new IssueCategory.severity for the seeded categories.
-- Apply with:   npm run db:phase5
-- Then score existing reports with:   npm run priority:backfill
--
-- Adds:
--   "Priority" enum (P1-P4) and "DuplicateStatus" enum
--   "IssueCategory"."severity"      1 (minor) .. 4 (dangerous), default 2
--   "Report": impact answers (affectedPeople, safetyHazard, blocksUse),
--             priority fields, review flags, duplicateOfId (confirmed link)
--   "PriorityAdjustment"            every manual priority change + reason
--   "DuplicateFlag"                 possible duplicates awaiting a decision
-- The DDL is exactly what Prisma generates for prisma/schema.prisma.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Priority') THEN
    CREATE TYPE "Priority" AS ENUM ('P1', 'P2', 'P3', 'P4');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DuplicateStatus') THEN
    CREATE TYPE "DuplicateStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED');
  END IF;
END $$;

ALTER TABLE "IssueCategory" ADD COLUMN IF NOT EXISTS "severity" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "Report"
  ADD COLUMN IF NOT EXISTS "affectedPeople" INTEGER,
  ADD COLUMN IF NOT EXISTS "autoPriority" "Priority",
  ADD COLUMN IF NOT EXISTS "blocksUse" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "duplicateOfId" TEXT,
  ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priority" "Priority",
  ADD COLUMN IF NOT EXISTS "priorityFactors" JSONB,
  ADD COLUMN IF NOT EXISTS "priorityLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priorityScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "reviewFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
  ADD COLUMN IF NOT EXISTS "safetyHazard" BOOLEAN;

CREATE TABLE IF NOT EXISTS "PriorityAdjustment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "fromPriority" "Priority",
    "toPriority" "Priority" NOT NULL,
    "autoPriority" "Priority",
    "reason" TEXT NOT NULL,
    "adjustedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriorityAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DuplicateFlag" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DuplicateFlag_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PriorityAdjustment_reportId_createdAt_idx" ON "PriorityAdjustment"("reportId", "createdAt");
CREATE INDEX IF NOT EXISTS "DuplicateFlag_candidateId_idx" ON "DuplicateFlag"("candidateId");
CREATE INDEX IF NOT EXISTS "DuplicateFlag_status_idx" ON "DuplicateFlag"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "DuplicateFlag_reportId_candidateId_key" ON "DuplicateFlag"("reportId", "candidateId");
CREATE INDEX IF NOT EXISTS "Report_priority_idx" ON "Report"("priority");
CREATE INDEX IF NOT EXISTS "Report_needsReview_idx" ON "Report"("needsReview");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_reviewedById_fkey') THEN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_reviewedById_fkey" FOREIGN KEY ("reviewedById")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_duplicateOfId_fkey') THEN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId")
      REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriorityAdjustment_reportId_fkey') THEN
    ALTER TABLE "PriorityAdjustment" ADD CONSTRAINT "PriorityAdjustment_reportId_fkey" FOREIGN KEY ("reportId")
      REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriorityAdjustment_adjustedById_fkey') THEN
    ALTER TABLE "PriorityAdjustment" ADD CONSTRAINT "PriorityAdjustment_adjustedById_fkey" FOREIGN KEY ("adjustedById")
      REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DuplicateFlag_reportId_fkey') THEN
    ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_reportId_fkey" FOREIGN KEY ("reportId")
      REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DuplicateFlag_candidateId_fkey') THEN
    ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_candidateId_fkey" FOREIGN KEY ("candidateId")
      REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DuplicateFlag_reviewedById_fkey') THEN
    ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_reviewedById_fkey" FOREIGN KEY ("reviewedById")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Starting severity per seeded category (4 = danger to people or property).
-- Only categories still at the default 2 are touched, so a value changed later
-- by hand is never overwritten when this script is run again.
UPDATE "IssueCategory" c
SET "severity" = v.severity
FROM (VALUES
  ('Faulty Wiring / Outlet', 4),  -- shock and fire risk
  ('Water Leak',             3),  -- spreading damage, slip risk
  ('Clogged Toilet / Drain', 3),  -- sanitation
  ('Cracked Wall / Ceiling', 3),  -- possible structural risk
  ('Damaged Gate / Railing', 3),  -- fall and security risk
  ('Broken Door / Window',   3),  -- security, injury risk
  ('Faulty Lighting',        2),
  ('Broken Fan / Aircon',    2),
  ('Peeling Paint / Mold',   2),  -- mold can affect health
  ('Damaged Chair / Table',  1),
  ('Cleaning / Grounds',     1)
) AS v(name, severity)
WHERE c."name" = v.name AND c."severity" = 2;

-- Phase 1 lockdown for the new tables
ALTER TABLE "PriorityAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DuplicateFlag" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api" ON "PriorityAdjustment";
CREATE POLICY "deny_data_api" ON "PriorityAdjustment" AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "deny_data_api" ON "DuplicateFlag";
CREATE POLICY "deny_data_api" ON "DuplicateFlag" AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON "PriorityAdjustment", "DuplicateFlag" FROM anon, authenticated;

COMMIT;
