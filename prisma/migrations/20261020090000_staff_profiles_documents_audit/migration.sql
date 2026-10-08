-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "StaffDocumentType" AS ENUM ('AADHAAR', 'PAN', 'QUALIFICATION', 'EXPERIENCE', 'PREVIOUS_EMPLOYMENT', 'APPOINTMENT_LETTER', 'JOINING', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVerification" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "module" TEXT;

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "employmentType" "EmploymentType",
ADD COLUMN     "experienceYears" INTEGER,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT;

-- CreateTable
CREATE TABLE "StaffDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "type" "StaffDocumentType" NOT NULL,
    "label" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "verification" "DocumentVerification" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,

    CONSTRAINT "StaffDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffDocument_schoolId_staffMemberId_idx" ON "StaffDocument"("schoolId", "staffMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffDocument_schoolId_id_key" ON "StaffDocument"("schoolId", "id");

-- CreateIndex
CREATE INDEX "AuditLog_schoolId_module_createdAt_idx" ON "AuditLog"("schoolId", "module", "createdAt");

-- AddForeignKey
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_schoolId_staffMemberId_fkey" FOREIGN KEY ("schoolId", "staffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

