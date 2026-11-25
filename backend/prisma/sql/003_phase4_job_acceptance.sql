-- =============================================================================
-- Phase 4: technicians accept or decline job assignments
--
-- Safe to run more than once. No existing rows are deleted.
-- Apply with:   npm run db:phase4
--
-- Adds:
--   "AssignmentStatus" enum   PENDING / ACCEPTED / DECLINED / CANCELLED
--   "JobOrder"."assignmentStatus"   the current technician's answer
--   "JobAssignment"           history of every offer and its outcome
--
-- Existing job orders (backfill, only where not done yet):
--   - not yet started (status ASSIGNED) with a technician -> PENDING:
--       that technician is asked to accept or decline it, like a new job
--   - already started, delayed, completed or closed        -> ACCEPTED
--   - no technician                                        -> left empty
--   Each gets one history row so analytics see the original assignment.
-- The DDL is exactly what Prisma generates for prisma/schema.prisma.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentStatus') THEN
    CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');
  END IF;
END $$;

ALTER TABLE "JobOrder" ADD COLUMN IF NOT EXISTS "assignmentStatus" "AssignmentStatus";

CREATE TABLE IF NOT EXISTS "JobAssignment" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "declineReason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "JobAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JobAssignment_jobOrderId_assignedAt_idx"
  ON "JobAssignment"("jobOrderId", "assignedAt");
CREATE INDEX IF NOT EXISTS "JobAssignment_technicianId_status_idx"
  ON "JobAssignment"("technicianId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobAssignment_jobOrderId_fkey') THEN
    ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_jobOrderId_fkey"
      FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobAssignment_technicianId_fkey') THEN
    ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_technicianId_fkey"
      FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobAssignment_assignedById_fkey') THEN
    ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_assignedById_fkey"
      FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- backfill existing job orders that have a technician (see header)
INSERT INTO "JobAssignment" ("id", "jobOrderId", "technicianId", "assignedById", "status", "assignedAt", "respondedAt")
SELECT gen_random_uuid()::text,
       jo."id",
       jo."technicianId",
       jo."createdById",
       CASE WHEN jo."status" = 'ASSIGNED' THEN 'PENDING'::"AssignmentStatus"
            ELSE 'ACCEPTED'::"AssignmentStatus" END,
       jo."createdAt",
       CASE WHEN jo."status" = 'ASSIGNED' THEN NULL ELSE jo."createdAt" END
FROM "JobOrder" jo
WHERE jo."technicianId" IS NOT NULL
  AND jo."assignmentStatus" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "JobAssignment" ja WHERE ja."jobOrderId" = jo."id");

UPDATE "JobOrder"
SET "assignmentStatus" = CASE WHEN "status" = 'ASSIGNED' THEN 'PENDING'::"AssignmentStatus"
                              ELSE 'ACCEPTED'::"AssignmentStatus" END
WHERE "technicianId" IS NOT NULL AND "assignmentStatus" IS NULL;

-- Phase 1 lockdown for the new table
ALTER TABLE "JobAssignment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api" ON "JobAssignment";
CREATE POLICY "deny_data_api" ON "JobAssignment" AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON "JobAssignment" FROM anon, authenticated;

COMMIT;
