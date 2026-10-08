-- DropIndex
DROP INDEX "FeeCharge_schoolId_academicSessionId_studentId_feeHeadId_key";

-- AlterTable
ALTER TABLE "AssessmentResult" ADD COLUMN     "exempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "FamilyPayment" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "voidedById" TEXT;

-- AlterTable
ALTER TABLE "FeeCharge" ADD COLUMN     "installmentNo" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lateFeeForId" TEXT;

-- AlterTable
ALTER TABLE "FeePayment" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "gradeBands" JSONB,
ADD COLUMN     "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateFeeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "passPercent" INTEGER NOT NULL DEFAULT 33;

-- CreateTable
CREATE TABLE "ResultScheme" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultScheme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResultScheme_schoolId_id_key" ON "ResultScheme"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ResultScheme_schoolId_academicSessionId_key" ON "ResultScheme"("schoolId", "academicSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyPayment_schoolId_idempotencyKey_key" ON "FamilyPayment"("schoolId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FeeCharge_schoolId_academicSessionId_studentId_feeHeadId_in_key" ON "FeeCharge"("schoolId", "academicSessionId", "studentId", "feeHeadId", "installmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "FeeCharge_schoolId_lateFeeForId_key" ON "FeeCharge"("schoolId", "lateFeeForId");

-- CreateIndex
CREATE UNIQUE INDEX "FeePayment_schoolId_idempotencyKey_key" ON "FeePayment"("schoolId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "FeeCharge" ADD CONSTRAINT "FeeCharge_schoolId_lateFeeForId_fkey" FOREIGN KEY ("schoolId", "lateFeeForId") REFERENCES "FeeCharge"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ResultScheme" ADD CONSTRAINT "ResultScheme_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultScheme" ADD CONSTRAINT "ResultScheme_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

