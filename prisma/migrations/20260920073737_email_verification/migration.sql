-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('SCHOOL_REGISTRATION');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "contactEmailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL DEFAULT 'SCHOOL_REGISTRATION',
    "codeHash" TEXT NOT NULL,
    "schoolId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailVerification_schoolId_purpose_idx" ON "EmailVerification"("schoolId", "purpose");

-- CreateIndex
CREATE INDEX "EmailVerification_email_purpose_idx" ON "EmailVerification"("email", "purpose");

-- CreateIndex
CREATE INDEX "EmailVerification_expiresAt_idx" ON "EmailVerification"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A school that is already live was approved before this gate existed, so it
-- counts as verified. Without this, every existing school would show as
-- unverified for ever — the check only guards approval, which they are past.
UPDATE "School"
SET "contactEmailVerifiedAt" = COALESCE("reviewedAt", "createdAt")
WHERE "status" = 'ACTIVE' AND "contactEmailVerifiedAt" IS NULL;
