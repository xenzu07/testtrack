-- =============================================================================
-- Phase 5 fix: one job order per problem when reports are confirmed duplicates
--
-- Safe to run more than once. No rows are changed or deleted.
-- Apply with:   npm run db:merge-duplicates
-- Then bring existing linked reports in line with:
--   npm run duplicates:reconcile -- --dry-run
--   npm run duplicates:reconcile
--
-- Adds:
--   "Status" value CANCELLED (job orders only: merged into another job order)
--   "JobOrder"."mergedIntoId"   the job order that continues the work
--   "JobOrder"."cancelledAt", "cancelReason"
-- The DDL is exactly what Prisma generates for prisma/schema.prisma.
-- =============================================================================

-- ADD VALUE cannot be combined with using the value in one transaction;
-- this script only adds it.
ALTER TYPE "Status" ADD VALUE IF NOT EXISTS 'CANCELLED';

BEGIN;

ALTER TABLE "JobOrder"
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobOrder_mergedIntoId_fkey') THEN
    ALTER TABLE "JobOrder" ADD CONSTRAINT "JobOrder_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId")
      REFERENCES "JobOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
