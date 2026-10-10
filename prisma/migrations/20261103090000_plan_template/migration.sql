-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "templateKey" TEXT;


-- Backfill from the explicit tier only (never from the name): the three
-- original plans start from their matching template. Plans made in the
-- Plan Builder have no tier and keep no template until one is chosen.
UPDATE "Plan" SET "templateKey" = CASE "tier" WHEN 'STARTER' THEN 'starter' WHEN 'STANDARD' THEN 'growth' WHEN 'PRO' THEN 'pro' END WHERE "tier" IS NOT NULL AND "templateKey" IS NULL;
