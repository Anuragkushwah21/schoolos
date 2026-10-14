-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('STUDENT_ID_CARD', 'BONAFIDE_CERTIFICATE', 'CHARACTER_CERTIFICATE', 'ATTENDANCE_CERTIFICATE', 'ENROLLMENT_CONFIRMATION', 'TRANSFER_CERTIFICATE', 'MARKSHEET', 'STAFF_ID_CARD', 'APPOINTMENT_LETTER', 'EMPLOYMENT_VERIFICATION', 'EXPERIENCE_CERTIFICATE', 'RELIEVING_LETTER', 'SALARY_CERTIFICATE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('GENERATED', 'ISSUED', 'REVOKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DocumentSignatory" AS ENUM ('PRINCIPAL', 'SCHOOL_ADMIN');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "adminSignatoryName" TEXT,
ADD COLUMN     "adminSignatoryTitle" TEXT,
ADD COLUMN     "adminSignatureKey" TEXT,
ADD COLUMN     "certificateSignatory" "DocumentSignatory" NOT NULL DEFAULT 'PRINCIPAL',
ADD COLUMN     "documentFooterNote" TEXT,
ADD COLUMN     "documentHeaderNote" TEXT,
ADD COLUMN     "employmentSignatory" "DocumentSignatory" NOT NULL DEFAULT 'PRINCIPAL',
ADD COLUMN     "principalSignatureKey" TEXT;

-- CreateTable
CREATE TABLE "IssuedDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL,
    "number" TEXT,
    "studentId" TEXT,
    "teacherId" TEXT,
    "staffMemberId" TEXT,
    "params" JSONB,
    "content" JSONB NOT NULL,
    "issuedOn" DATE NOT NULL,
    "generatedById" TEXT,
    "issuedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "supersededById" TEXT,
    "batchKey" TEXT,
    "requestKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssuedDocument_schoolId_type_status_idx" ON "IssuedDocument"("schoolId", "type", "status");

-- CreateIndex
CREATE INDEX "IssuedDocument_schoolId_studentId_idx" ON "IssuedDocument"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "IssuedDocument_schoolId_teacherId_idx" ON "IssuedDocument"("schoolId", "teacherId");

-- CreateIndex
CREATE INDEX "IssuedDocument_schoolId_staffMemberId_idx" ON "IssuedDocument"("schoolId", "staffMemberId");

-- CreateIndex
CREATE INDEX "IssuedDocument_schoolId_batchKey_idx" ON "IssuedDocument"("schoolId", "batchKey");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedDocument_schoolId_id_key" ON "IssuedDocument"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedDocument_schoolId_number_key" ON "IssuedDocument"("schoolId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedDocument_schoolId_requestKey_key" ON "IssuedDocument"("schoolId", "requestKey");

-- AddForeignKey
ALTER TABLE "IssuedDocument" ADD CONSTRAINT "IssuedDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedDocument" ADD CONSTRAINT "IssuedDocument_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "IssuedDocument" ADD CONSTRAINT "IssuedDocument_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "IssuedDocument" ADD CONSTRAINT "IssuedDocument_schoolId_staffMemberId_fkey" FOREIGN KEY ("schoolId", "staffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

