-- =============================================================================
-- Phase 6: reporter Job Order Forms with e-signature
--
-- Safe to run more than once. No existing rows are changed or deleted.
-- Apply with:   npm run db:phase6
--
-- Adds the "FormStatus" enum and the "JobOrderForm" table (one signed form per
-- report). Signature images live in the private storage bucket under
-- signatures/<reportId>/ and are covered by the Phase 1 storage policy.
-- The DDL is exactly what Prisma generates for prisma/schema.prisma.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormStatus') THEN
    CREATE TYPE "FormStatus" AS ENUM ('SUBMITTED', 'RECEIVED', 'APPROVED', 'RETURNED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "JobOrderForm" (
    "id" TEXT NOT NULL,
    "formNo" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "requesterType" TEXT,
    "department" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "workRequested" TEXT NOT NULL,
    "locationText" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "preferredSchedule" TEXT,
    "notes" TEXT,
    "certified" BOOLEAN NOT NULL,
    "signaturePath" TEXT NOT NULL,
    "signatureHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'SUBMITTED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobOrderForm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JobOrderForm_formNo_key" ON "JobOrderForm"("formNo");
CREATE UNIQUE INDEX IF NOT EXISTS "JobOrderForm_reportId_key" ON "JobOrderForm"("reportId");
CREATE INDEX IF NOT EXISTS "JobOrderForm_status_submittedAt_idx" ON "JobOrderForm"("status", "submittedAt");
CREATE INDEX IF NOT EXISTS "JobOrderForm_requesterId_idx" ON "JobOrderForm"("requesterId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobOrderForm_reportId_fkey') THEN
    ALTER TABLE "JobOrderForm" ADD CONSTRAINT "JobOrderForm_reportId_fkey" FOREIGN KEY ("reportId")
      REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobOrderForm_requesterId_fkey') THEN
    ALTER TABLE "JobOrderForm" ADD CONSTRAINT "JobOrderForm_requesterId_fkey" FOREIGN KEY ("requesterId")
      REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobOrderForm_receivedById_fkey') THEN
    ALTER TABLE "JobOrderForm" ADD CONSTRAINT "JobOrderForm_receivedById_fkey" FOREIGN KEY ("receivedById")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobOrderForm_decidedById_fkey') THEN
    ALTER TABLE "JobOrderForm" ADD CONSTRAINT "JobOrderForm_decidedById_fkey" FOREIGN KEY ("decidedById")
      REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Phase 1 lockdown: forms and signatures are only reachable through the API
ALTER TABLE "JobOrderForm" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api" ON "JobOrderForm";
CREATE POLICY "deny_data_api" ON "JobOrderForm" AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON "JobOrderForm" FROM anon, authenticated;

COMMIT;
