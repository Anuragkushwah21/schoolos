-- Plan Builder, extra-campus pricing, plan features and custom feature requests.
-- Additive only: no column is dropped and no school, subscription or campus
-- row is changed. Existing plans are backfilled so they behave as before.

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "FeatureRequestStatus" AS ENUM ('SUBMITTED', 'NEEDS_INFO', 'UNDER_EVALUATION', 'APPROVED', 'IN_DEVELOPMENT', 'TESTING', 'RELEASED', 'DECLINED');

-- CreateEnum
CREATE TYPE "FeatureRequestPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FeatureReleaseScope" AS ENUM ('CUSTOMER_SPECIFIC', 'OPTIONAL_MODULE', 'STANDARD_FEATURE', 'PREMIUM_ADDON');

-- AlterTable
ALTER TABLE "CampusRequest" ADD COLUMN     "quotedExtraFeeMinor" INTEGER,
ADD COLUMN     "quotedExtraPeriod" "BillingPeriod";

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'YEARLY',
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "draft" JSONB,
ADD COLUMN     "draftById" TEXT,
ADD COLUMN     "draftUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "extraCampusAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extraCampusPeriod" "BillingPeriod" NOT NULL DEFAULT 'YEARLY',
ADD COLUMN     "extraCampusPriceMinor" INTEGER,
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maxCampuses" INTEGER,
ADD COLUMN     "priceOnRequest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "status" "PlanStatus" NOT NULL DEFAULT 'PUBLISHED',
ALTER COLUMN "tier" DROP NOT NULL;

-- Backfill: a stable slug and display order from the original tiers.
UPDATE "Plan" SET "slug" = lower("tier"::text) WHERE "slug" IS NULL AND "tier" IS NOT NULL;
UPDATE "Plan" SET "slug" = "id" WHERE "slug" IS NULL;
ALTER TABLE "Plan" ALTER COLUMN "slug" SET NOT NULL;
UPDATE "Plan" SET "displayOrder" = CASE "tier" WHEN 'STARTER' THEN 1 WHEN 'STANDARD' THEN 2 WHEN 'PRO' THEN 3 ELSE 10 END;
UPDATE "Plan" SET "publishedAt" = "updatedAt" WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL;
-- Fees & finance and expense records are essential for every school: make
-- them eligible on every plan (eligibility only; no campus is changed).
UPDATE "Plan" SET "optionalModules" = array_append("optionalModules", 'FINANCE') WHERE NOT ('FINANCE' = ANY("optionalModules"));
UPDATE "Plan" SET "optionalModules" = array_append("optionalModules", 'EXPENSES') WHERE NOT ('EXPENSES' = ANY("optionalModules"));
-- Keep what owners have today: plans that already allow several campuses get
-- the organization dashboard; Pro gets custom feature requests.
UPDATE "Plan" SET "features" = array_append("features", 'ORG_DASHBOARD') WHERE ("campusLimit" > 1 OR "tier" IN ('STANDARD', 'PRO')) AND NOT ('ORG_DASHBOARD' = ANY("features"));
UPDATE "Plan" SET "features" = array_append("features", 'FEATURE_REQUESTS') WHERE "tier" = 'PRO' AND NOT ('FEATURE_REQUESTS' = ANY("features"));

-- CreateTable
CREATE TABLE "FeatureRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT,
    "requestedById" TEXT,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expectedOutcome" TEXT,
    "moduleKey" TEXT,
    "priority" "FeatureRequestPriority" NOT NULL DEFAULT 'MEDIUM',
    "examples" TEXT,
    "status" "FeatureRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "estimatedTimeline" TEXT,
    "estimatedCostMinor" INTEGER,
    "costAgreed" BOOLEAN NOT NULL DEFAULT false,
    "potentialStandard" BOOLEAN NOT NULL DEFAULT false,
    "releaseScope" "FeatureReleaseScope",
    "eligiblePlanIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibleOrgIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "releaseNote" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "developedBy" TEXT,
    "testedBy" TEXT,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureRequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" "FeatureRequestStatus",
    "toStatus" "FeatureRequestStatus",
    "body" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeatureRequest_organizationId_createdAt_idx" ON "FeatureRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "FeatureRequest_status_createdAt_idx" ON "FeatureRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FeatureRequestEvent_requestId_createdAt_idx" ON "FeatureRequestEvent"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- AddForeignKey
ALTER TABLE "FeatureRequest" ADD CONSTRAINT "FeatureRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureRequest" ADD CONSTRAINT "FeatureRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureRequest" ADD CONSTRAINT "FeatureRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureRequestEvent" ADD CONSTRAINT "FeatureRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FeatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureRequestEvent" ADD CONSTRAINT "FeatureRequestEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

