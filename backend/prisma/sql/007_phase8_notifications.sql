-- =============================================================================
-- Phase 8: notifications (in-app list with read / unread, plus push)
--
-- Safe to run more than once. No existing rows are changed or deleted.
-- Apply with:   npm run db:phase8
--
-- Adds:
--   "Notification"  one row per person per event; (userId, dedupeKey) is unique
--                   so the same event can never notify someone twice
--   "PushDevice"    phones (Firebase token) and browsers (Web Push subscription)
--                   registered by signed-in users
-- The DDL is exactly what Prisma generates for prisma/schema.prisma.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PushPlatform') THEN
    CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reportId" TEXT,
    "jobOrderId" TEXT,
    "formId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "p256dh" TEXT,
    "auth" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PushDevice_token_key" ON "PushDevice"("token");
CREATE INDEX IF NOT EXISTS "PushDevice_userId_idx" ON "PushDevice"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_reportId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reportId_fkey" FOREIGN KEY ("reportId")
      REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushDevice_userId_fkey') THEN
    ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Phase 1 lockdown: only the API (server-side) can read or write these
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api" ON "Notification";
CREATE POLICY "deny_data_api" ON "Notification" AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON "Notification" FROM anon, authenticated;

ALTER TABLE "PushDevice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api" ON "PushDevice";
CREATE POLICY "deny_data_api" ON "PushDevice" AS RESTRICTIVE FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON "PushDevice" FROM anon, authenticated;

COMMIT;
