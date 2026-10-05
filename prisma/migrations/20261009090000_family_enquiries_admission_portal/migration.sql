-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EnquirySource" AS ENUM ('WEBSITE', 'WALK_IN', 'PHONE', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "EnquiryChildStatus" AS ENUM ('OPEN', 'ADMITTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('NONE', 'FIXED', 'PERCENT');

-- CreateEnum
CREATE TYPE "FeeDiscussionStatus" AS ENUM ('NOT_STARTED', 'DISCUSSING', 'AGREED');

-- AlterEnum
BEGIN;
CREATE TYPE "AdmissionStatus_new" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'APPROVED', 'REJECTED', 'CONVERTED');
ALTER TABLE "public"."AdmissionApplication" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "AdmissionApplication" ALTER COLUMN "status" TYPE "AdmissionStatus_new" USING (
  CASE "status"::text
    -- An accepted application already became a student; a waitlisted one is on the shortlist.
    WHEN 'ACCEPTED' THEN 'CONVERTED'
    WHEN 'WAITLISTED' THEN 'SHORTLISTED'
    ELSE "status"::text
  END
)::"AdmissionStatus_new";
ALTER TYPE "AdmissionStatus" RENAME TO "AdmissionStatus_old";
ALTER TYPE "AdmissionStatus_new" RENAME TO "AdmissionStatus";
DROP TYPE "public"."AdmissionStatus_old";
ALTER TABLE "AdmissionApplication" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
COMMIT;

-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "customAnswers" JSONB,
ADD COLUMN     "familyKey" TEXT;

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "enquiryNumber" TEXT NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "source" "EnquirySource" NOT NULL DEFAULT 'WALK_IN',
    "parentName" TEXT NOT NULL,
    "relationship" "ParentRelationship" NOT NULL DEFAULT 'GUARDIAN',
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "email" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "existingParentId" TEXT,
    "notes" TEXT,
    "nextFollowUpOn" DATE,
    "nextAction" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "feeStatus" "FeeDiscussionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "familyDiscountKind" "DiscountKind" NOT NULL DEFAULT 'NONE',
    "familyDiscountValue" INTEGER NOT NULL DEFAULT 0,
    "familyDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "familyDiscountReason" TEXT,
    "discussionNotes" TEXT,
    "feeAgreedAt" TIMESTAMP(3),
    "feeAgreedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryChild" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "EnquiryChildStatus" NOT NULL DEFAULT 'OPEN',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "classId" TEXT NOT NULL,
    "streamId" TEXT,
    "previousSchool" TEXT,
    "notes" TEXT,
    "feeOriginalMinor" INTEGER,
    "discountKind" "DiscountKind" NOT NULL DEFAULT 'NONE',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "finalMinor" INTEGER,
    "discountReason" TEXT,
    "feeNotes" TEXT,
    "feeUpdatedAt" TIMESTAMP(3),
    "convertedStudentId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "concessionAppliedAt" TIMESTAMP(3),
    "concessionChargeId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquiryChild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryFollowUp" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "nextAction" TEXT,
    "nextFollowUpOn" DATE,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryFeeRevision" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "childId" TEXT,
    "childName" TEXT,
    "originalMinor" INTEGER NOT NULL,
    "discountKind" "DiscountKind" NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL,
    "finalMinor" INTEGER NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryFeeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionPortal" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "opensOn" DATE,
    "closesOn" DATE,
    "instructions" TEXT,
    "mapUrl" TEXT,
    "websiteUrl" TEXT,
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "classIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customFields" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionPortal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Enquiry_schoolId_status_createdAt_idx" ON "Enquiry"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Enquiry_schoolId_phone_idx" ON "Enquiry"("schoolId", "phone");

-- CreateIndex
CREATE INDEX "Enquiry_schoolId_nextFollowUpOn_idx" ON "Enquiry"("schoolId", "nextFollowUpOn");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_schoolId_id_key" ON "Enquiry"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_schoolId_enquiryNumber_key" ON "Enquiry"("schoolId", "enquiryNumber");

-- CreateIndex
CREATE INDEX "EnquiryChild_schoolId_enquiryId_idx" ON "EnquiryChild"("schoolId", "enquiryId");

-- CreateIndex
CREATE INDEX "EnquiryChild_schoolId_firstName_idx" ON "EnquiryChild"("schoolId", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "EnquiryChild_schoolId_id_key" ON "EnquiryChild"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EnquiryChild_schoolId_convertedStudentId_key" ON "EnquiryChild"("schoolId", "convertedStudentId");

-- CreateIndex
CREATE INDEX "EnquiryFollowUp_schoolId_enquiryId_createdAt_idx" ON "EnquiryFollowUp"("schoolId", "enquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EnquiryFollowUp_schoolId_id_key" ON "EnquiryFollowUp"("schoolId", "id");

-- CreateIndex
CREATE INDEX "EnquiryFeeRevision_schoolId_enquiryId_createdAt_idx" ON "EnquiryFeeRevision"("schoolId", "enquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EnquiryFeeRevision_schoolId_id_key" ON "EnquiryFeeRevision"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionPortal_schoolId_key" ON "AdmissionPortal"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionPortal_schoolId_id_key" ON "AdmissionPortal"("schoolId", "id");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_familyKey_idx" ON "AdmissionApplication"("schoolId", "familyKey");

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_schoolId_existingParentId_fkey" FOREIGN KEY ("schoolId", "existingParentId") REFERENCES "Parent"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_feeAgreedById_fkey" FOREIGN KEY ("feeAgreedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryChild" ADD CONSTRAINT "EnquiryChild_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryChild" ADD CONSTRAINT "EnquiryChild_schoolId_enquiryId_fkey" FOREIGN KEY ("schoolId", "enquiryId") REFERENCES "Enquiry"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EnquiryChild" ADD CONSTRAINT "EnquiryChild_schoolId_classId_fkey" FOREIGN KEY ("schoolId", "classId") REFERENCES "Class"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EnquiryChild" ADD CONSTRAINT "EnquiryChild_schoolId_streamId_fkey" FOREIGN KEY ("schoolId", "streamId") REFERENCES "Stream"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EnquiryChild" ADD CONSTRAINT "EnquiryChild_schoolId_convertedStudentId_fkey" FOREIGN KEY ("schoolId", "convertedStudentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EnquiryChild" ADD CONSTRAINT "EnquiryChild_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryChild" ADD CONSTRAINT "EnquiryChild_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryFollowUp" ADD CONSTRAINT "EnquiryFollowUp_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryFollowUp" ADD CONSTRAINT "EnquiryFollowUp_schoolId_enquiryId_fkey" FOREIGN KEY ("schoolId", "enquiryId") REFERENCES "Enquiry"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EnquiryFollowUp" ADD CONSTRAINT "EnquiryFollowUp_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryFeeRevision" ADD CONSTRAINT "EnquiryFeeRevision_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryFeeRevision" ADD CONSTRAINT "EnquiryFeeRevision_schoolId_enquiryId_fkey" FOREIGN KEY ("schoolId", "enquiryId") REFERENCES "Enquiry"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EnquiryFeeRevision" ADD CONSTRAINT "EnquiryFeeRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionPortal" ADD CONSTRAINT "AdmissionPortal_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionPortal" ADD CONSTRAINT "AdmissionPortal_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

