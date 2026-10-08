-- CreateEnum
CREATE TYPE "CampusRequestStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MODIFIED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "availableRoles" TEXT[] DEFAULT ARRAY['PRINCIPAL', 'ACCOUNTANT', 'RECEPTIONIST', 'LIBRARIAN', 'DRIVER', 'TRANSPORT_ATTENDANT', 'PEON', 'OFFICE_STAFF', 'COORDINATOR', 'SECURITY', 'LAB_ASSISTANT', 'OTHER']::TEXT[],
ADD COLUMN     "campusLimit" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "roleLimits" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "enabledRoles" TEXT[] DEFAULT ARRAY['PRINCIPAL', 'ACCOUNTANT', 'RECEPTIONIST', 'LIBRARIAN', 'DRIVER', 'TRANSPORT_ATTENDANT', 'PEON', 'OFFICE_STAFF', 'COORDINATOR', 'SECURITY', 'LAB_ASSISTANT', 'OTHER']::TEXT[],
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "roleLimits" JSONB,
ADD COLUMN     "rolesCustomized" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "activeSchoolId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "campusLimitOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromSchoolId" TEXT,
    "requestedById" TEXT,
    "status" "CampusRequestStatus" NOT NULL DEFAULT 'PENDING',
    "name" TEXT NOT NULL,
    "addressLine" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "affiliationBoard" TEXT,
    "expectedStudents" INTEGER,
    "expectedTeachers" INTEGER,
    "expectedStaff" INTEGER,
    "notes" TEXT,
    "requestedModules" TEXT[],
    "requestedRoles" TEXT[],
    "requestedLimits" JSONB NOT NULL DEFAULT '{}',
    "approvedModules" TEXT[],
    "approvedRoles" TEXT[],
    "approvedLimits" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "createdSchoolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampusRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_ownerId_key" ON "Organization"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CampusRequest_createdSchoolId_key" ON "CampusRequest"("createdSchoolId");

-- CreateIndex
CREATE INDEX "CampusRequest_organizationId_status_idx" ON "CampusRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CampusRequest_status_createdAt_idx" ON "CampusRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "School_organizationId_idx" ON "School"("organizationId");

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusRequest" ADD CONSTRAINT "CampusRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusRequest" ADD CONSTRAINT "CampusRequest_fromSchoolId_fkey" FOREIGN KEY ("fromSchoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusRequest" ADD CONSTRAINT "CampusRequest_createdSchoolId_fkey" FOREIGN KEY ("createdSchoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusRequest" ADD CONSTRAINT "CampusRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusRequest" ADD CONSTRAINT "CampusRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: every existing school becomes the single (primary) campus of its
-- own organization. Safe to run again (idempotent):
--   * only schools without an organization are touched;
--   * the organization id is derived from the school id, and a clash is skipped;
--   * the owner is the school's earliest School Admin, unless that login
--     already owns an organization.
-- School ids, names and every operational row stay exactly as they are.
INSERT INTO "Organization" ("id", "name", "ownerId", "createdAt", "updatedAt")
SELECT
  'org_' || s."id",
  s."name",
  (
    SELECT u."id" FROM "User" u
    WHERE u."schoolId" = s."id" AND u."role" = 'SCHOOL_ADMIN'
      AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."ownerId" = u."id")
    ORDER BY u."createdAt" ASC, u."id" ASC
    LIMIT 1
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "School" s
WHERE s."organizationId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "School" s SET "organizationId" = 'org_' || s."id"
WHERE s."organizationId" IS NULL
  AND EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = 'org_' || s."id");
