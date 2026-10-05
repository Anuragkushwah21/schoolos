-- Exams & tests, Needs Attention, support remarks, library lost/damaged copies,
-- enquiry follow-ups, parent archive, and fees: concessions, family payments
-- and carry-forward of earlier sessions' balances.
--
-- Additive only. The two backfills at the end keep what families already see:
--   * class tests have so far been visible as soon as marks were entered, so
--     every class test with marks starts as SUBMITTED (visible);
--   * papers of already-published exams start as SUBMITTED (locked).

-- CreateEnum
CREATE TYPE "AssessmentMarksStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "AdmissionSource" AS ENUM ('WEBSITE', 'WALK_IN', 'PHONE', 'ADMIN');

-- CreateEnum
CREATE TYPE "AdmissionType" AS ENUM ('NEW', 'TRANSFER', 'READMISSION');

-- CreateEnum
CREATE TYPE "ConcessionKind" AS ENUM ('FIXED', 'PERCENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookCopyStatus" ADD VALUE 'LOST';
ALTER TYPE "BookCopyStatus" ADD VALUE 'DAMAGED';

-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "source" "AdmissionSource" NOT NULL DEFAULT 'WEBSITE';

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "description" TEXT,
ADD COLUMN     "marksStatus" "AssessmentMarksStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "streamId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT;

-- AlterTable
ALTER TABLE "BookCopy" ADD COLUMN     "conditionNote" TEXT,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BookIssue" ADD COLUMN     "lostOn" DATE;

-- AlterTable
ALTER TABLE "FeeHead" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FeePayment" ADD COLUMN     "familyPaymentId" TEXT;

-- AlterTable
ALTER TABLE "Parent" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "familyPaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsAttentionPercent" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "needsAttentionRepeat" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "admissionType" "AdmissionType";

-- AlterTable
ALTER TABLE "StudentSupport" ADD COLUMN     "parentRemark" TEXT;

-- CreateTable
CREATE TABLE "AdmissionFollowUp" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "nextFollowUpOn" DATE,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeConcession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "feeChargeId" TEXT NOT NULL,
    "kind" "ConcessionKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL,
    "originalMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeConcession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyPayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "referenceNo" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeCarryForward" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromSessionId" TEXT NOT NULL,
    "toSessionId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "feeChargeId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeCarryForward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdmissionFollowUp_schoolId_applicationId_createdAt_idx" ON "AdmissionFollowUp"("schoolId", "applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionFollowUp_schoolId_id_key" ON "AdmissionFollowUp"("schoolId", "id");

-- CreateIndex
CREATE INDEX "FeeConcession_schoolId_feeChargeId_idx" ON "FeeConcession"("schoolId", "feeChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeConcession_schoolId_id_key" ON "FeeConcession"("schoolId", "id");

-- CreateIndex
CREATE INDEX "FamilyPayment_schoolId_parentId_idx" ON "FamilyPayment"("schoolId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyPayment_schoolId_id_key" ON "FamilyPayment"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyPayment_schoolId_receiptNo_key" ON "FamilyPayment"("schoolId", "receiptNo");

-- CreateIndex
CREATE INDEX "FeeCarryForward_schoolId_toSessionId_idx" ON "FeeCarryForward"("schoolId", "toSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeCarryForward_schoolId_id_key" ON "FeeCarryForward"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FeeCarryForward_schoolId_studentId_fromSessionId_key" ON "FeeCarryForward"("schoolId", "studentId", "fromSessionId");

-- CreateIndex
CREATE INDEX "FeePayment_schoolId_familyPaymentId_idx" ON "FeePayment"("schoolId", "familyPaymentId");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_streamId_fkey" FOREIGN KEY ("schoolId", "streamId") REFERENCES "Stream"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_schoolId_familyPaymentId_fkey" FOREIGN KEY ("schoolId", "familyPaymentId") REFERENCES "FamilyPayment"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionFollowUp" ADD CONSTRAINT "AdmissionFollowUp_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionFollowUp" ADD CONSTRAINT "AdmissionFollowUp_schoolId_applicationId_fkey" FOREIGN KEY ("schoolId", "applicationId") REFERENCES "AdmissionApplication"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionFollowUp" ADD CONSTRAINT "AdmissionFollowUp_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeConcession" ADD CONSTRAINT "FeeConcession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeConcession" ADD CONSTRAINT "FeeConcession_schoolId_feeChargeId_fkey" FOREIGN KEY ("schoolId", "feeChargeId") REFERENCES "FeeCharge"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FeeConcession" ADD CONSTRAINT "FeeConcession_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyPayment" ADD CONSTRAINT "FamilyPayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyPayment" ADD CONSTRAINT "FamilyPayment_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FamilyPayment" ADD CONSTRAINT "FamilyPayment_schoolId_parentId_fkey" FOREIGN KEY ("schoolId", "parentId") REFERENCES "Parent"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FamilyPayment" ADD CONSTRAINT "FamilyPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeCarryForward" ADD CONSTRAINT "FeeCarryForward_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeCarryForward" ADD CONSTRAINT "FeeCarryForward_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FeeCarryForward" ADD CONSTRAINT "FeeCarryForward_schoolId_fromSessionId_fkey" FOREIGN KEY ("schoolId", "fromSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FeeCarryForward" ADD CONSTRAINT "FeeCarryForward_schoolId_toSessionId_fkey" FOREIGN KEY ("schoolId", "toSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FeeCarryForward" ADD CONSTRAINT "FeeCarryForward_schoolId_feeChargeId_fkey" FOREIGN KEY ("schoolId", "feeChargeId") REFERENCES "FeeCharge"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FeeCarryForward" ADD CONSTRAINT "FeeCarryForward_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: keep existing results exactly as visible as they were.
UPDATE "Assessment" a
SET "marksStatus" = 'SUBMITTED', "submittedAt" = now()
WHERE a."examId" IS NULL
  AND EXISTS (SELECT 1 FROM "AssessmentResult" r WHERE r."schoolId" = a."schoolId" AND r."assessmentId" = a."id");

UPDATE "Assessment" a
SET "marksStatus" = 'SUBMITTED', "submittedAt" = COALESCE(e."publishedAt", now())
FROM "Exam" e
WHERE e."schoolId" = a."schoolId" AND e."id" = a."examId" AND e."status" = 'PUBLISHED';
