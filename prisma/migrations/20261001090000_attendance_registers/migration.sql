-- CreateEnum
CREATE TYPE "RegisterTiming" AS ENUM ('FIRST_PERIOD', 'LAST_PERIOD');

-- CreateEnum
CREATE TYPE "RegisterSubmission" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "RegisterStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "attendanceSubmission" "RegisterSubmission" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "attendanceTiming" "RegisterTiming" NOT NULL DEFAULT 'FIRST_PERIOD';

-- CreateTable
CREATE TABLE "AttendanceRegister" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "RegisterStatus" NOT NULL DEFAULT 'DRAFT',
    "draft" JSONB,
    "draftSavedAt" TIMESTAMP(3),
    "finalizeAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "autoSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "correctionDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterCover" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "teacherId" TEXT NOT NULL,
    "reason" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisterCover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCover" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "absentStaffMemberId" TEXT NOT NULL,
    "coverStaffMemberId" TEXT NOT NULL,
    "duties" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceRegister_schoolId_status_finalizeAt_idx" ON "AttendanceRegister"("schoolId", "status", "finalizeAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRegister_schoolId_id_key" ON "AttendanceRegister"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRegister_schoolId_sectionId_date_key" ON "AttendanceRegister"("schoolId", "sectionId", "date");

-- CreateIndex
CREATE INDEX "RegisterCover_schoolId_teacherId_date_idx" ON "RegisterCover"("schoolId", "teacherId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterCover_schoolId_id_key" ON "RegisterCover"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterCover_schoolId_sectionId_date_key" ON "RegisterCover"("schoolId", "sectionId", "date");

-- CreateIndex
CREATE INDEX "WorkCover_schoolId_coverStaffMemberId_date_idx" ON "WorkCover"("schoolId", "coverStaffMemberId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCover_schoolId_id_key" ON "WorkCover"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCover_schoolId_date_absentStaffMemberId_coverStaffMembe_key" ON "WorkCover"("schoolId", "date", "absentStaffMemberId", "coverStaffMemberId");

-- AddForeignKey
ALTER TABLE "AttendanceRegister" ADD CONSTRAINT "AttendanceRegister_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRegister" ADD CONSTRAINT "AttendanceRegister_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AttendanceRegister" ADD CONSTRAINT "AttendanceRegister_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AttendanceRegister" ADD CONSTRAINT "AttendanceRegister_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterCover" ADD CONSTRAINT "RegisterCover_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterCover" ADD CONSTRAINT "RegisterCover_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RegisterCover" ADD CONSTRAINT "RegisterCover_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RegisterCover" ADD CONSTRAINT "RegisterCover_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCover" ADD CONSTRAINT "WorkCover_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCover" ADD CONSTRAINT "WorkCover_schoolId_absentStaffMemberId_fkey" FOREIGN KEY ("schoolId", "absentStaffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkCover" ADD CONSTRAINT "WorkCover_schoolId_coverStaffMemberId_fkey" FOREIGN KEY ("schoolId", "coverStaffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkCover" ADD CONSTRAINT "WorkCover_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

