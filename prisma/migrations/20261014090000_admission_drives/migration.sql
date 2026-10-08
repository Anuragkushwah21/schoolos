-- CreateEnum
CREATE TYPE "AdmissionDriveStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'PAUSED', 'CLOSED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AdmissionSource" ADD VALUE 'DRIVE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdmissionStatus" ADD VALUE 'DRAFT';
ALTER TYPE "AdmissionStatus" ADD VALUE 'CORRECTION_REQUESTED';

-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "driveId" TEXT;

-- CreateTable
CREATE TABLE "AdmissionDrive" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AdmissionDriveStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionDrive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT,
    "teacherId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "permissions" TEXT[],
    "pausedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "AdmissionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdmissionDrive_schoolId_status_idx" ON "AdmissionDrive"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionDrive_schoolId_id_key" ON "AdmissionDrive"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionDrive_schoolId_academicSessionId_name_key" ON "AdmissionDrive"("schoolId", "academicSessionId", "name");

-- CreateIndex
CREATE INDEX "AdmissionAssignment_schoolId_driveId_idx" ON "AdmissionAssignment"("schoolId", "driveId");

-- CreateIndex
CREATE INDEX "AdmissionAssignment_schoolId_teacherId_idx" ON "AdmissionAssignment"("schoolId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionAssignment_schoolId_id_key" ON "AdmissionAssignment"("schoolId", "id");

-- CreateIndex
CREATE INDEX "AdmissionDocument_schoolId_applicationId_idx" ON "AdmissionDocument"("schoolId", "applicationId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_assignmentId_idx" ON "AdmissionApplication"("schoolId", "assignmentId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_driveId_idx" ON "AdmissionApplication"("schoolId", "driveId");

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_schoolId_driveId_fkey" FOREIGN KEY ("schoolId", "driveId") REFERENCES "AdmissionDrive"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_schoolId_assignmentId_fkey" FOREIGN KEY ("schoolId", "assignmentId") REFERENCES "AdmissionAssignment"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionDrive" ADD CONSTRAINT "AdmissionDrive_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDrive" ADD CONSTRAINT "AdmissionDrive_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionAssignment" ADD CONSTRAINT "AdmissionAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionAssignment" ADD CONSTRAINT "AdmissionAssignment_schoolId_driveId_fkey" FOREIGN KEY ("schoolId", "driveId") REFERENCES "AdmissionDrive"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionAssignment" ADD CONSTRAINT "AdmissionAssignment_schoolId_classId_fkey" FOREIGN KEY ("schoolId", "classId") REFERENCES "Class"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionAssignment" ADD CONSTRAINT "AdmissionAssignment_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionAssignment" ADD CONSTRAINT "AdmissionAssignment_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_schoolId_applicationId_fkey" FOREIGN KEY ("schoolId", "applicationId") REFERENCES "AdmissionApplication"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

