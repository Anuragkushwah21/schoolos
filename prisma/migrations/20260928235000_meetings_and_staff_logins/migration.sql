-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('PTM', 'GENERAL');

-- CreateEnum
CREATE TYPE "MeetingAudience" AS ENUM ('ALL', 'PARENTS', 'STUDENTS', 'TEACHERS', 'NON_TEACHING_STAFF');

-- CreateEnum
CREATE TYPE "MeetingScope" AS ENUM ('SCHOOL', 'SECTIONS', 'PEOPLE');

-- CreateEnum
CREATE TYPE "StaffPermission" AS ENUM ('VIEW_STUDENTS', 'VIEW_LIBRARY', 'VIEW_TRANSPORT');

-- AlterEnum
ALTER TYPE "NoticeAudience" ADD VALUE 'NON_TEACHING_STAFF';

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'LAB_ASSISTANT';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'NON_TEACHING_STAFF';

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "department" TEXT,
ADD COLUMN     "permissions" "StaffPermission"[] DEFAULT ARRAY[]::"StaffPermission"[],
ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT,
    "type" "MeetingType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER,
    "location" TEXT,
    "meetingLink" TEXT,
    "audiences" "MeetingAudience"[],
    "scope" "MeetingScope" NOT NULL DEFAULT 'SCHOOL',
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingSection" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,

CONSTRAINT "MeetingSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingRecipient" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

CONSTRAINT "MeetingRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_schoolId_date_idx" ON "Meeting"("schoolId", "date");

-- CreateIndex
CREATE INDEX "Meeting_schoolId_status_date_idx" ON "Meeting"("schoolId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_schoolId_id_key" ON "Meeting"("schoolId", "id");

-- CreateIndex
CREATE INDEX "MeetingSection_schoolId_sectionId_idx" ON "MeetingSection"("schoolId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingSection_schoolId_id_key" ON "MeetingSection"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingSection_schoolId_meetingId_sectionId_key" ON "MeetingSection"("schoolId", "meetingId", "sectionId");

-- CreateIndex
CREATE INDEX "MeetingRecipient_schoolId_userId_idx" ON "MeetingRecipient"("schoolId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecipient_schoolId_id_key" ON "MeetingRecipient"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecipient_schoolId_meetingId_userId_key" ON "MeetingRecipient"("schoolId", "meetingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolId_id_key" ON "User"("schoolId", "id");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSection" ADD CONSTRAINT "MeetingSection_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSection" ADD CONSTRAINT "MeetingSection_schoolId_meetingId_fkey" FOREIGN KEY ("schoolId", "meetingId") REFERENCES "Meeting"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MeetingSection" ADD CONSTRAINT "MeetingSection_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MeetingRecipient" ADD CONSTRAINT "MeetingRecipient_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecipient" ADD CONSTRAINT "MeetingRecipient_schoolId_meetingId_fkey" FOREIGN KEY ("schoolId", "meetingId") REFERENCES "Meeting"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MeetingRecipient" ADD CONSTRAINT "MeetingRecipient_schoolId_userId_fkey" FOREIGN KEY ("schoolId", "userId") REFERENCES "User"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MeetingStudent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "MeetingStudent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingStudent_schoolId_studentId_idx" ON "MeetingStudent"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingStudent_schoolId_id_key" ON "MeetingStudent"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingStudent_schoolId_meetingId_studentId_key" ON "MeetingStudent"("schoolId", "meetingId", "studentId");

-- AddForeignKey
ALTER TABLE "MeetingStudent" ADD CONSTRAINT "MeetingStudent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingStudent" ADD CONSTRAINT "MeetingStudent_schoolId_meetingId_fkey" FOREIGN KEY ("schoolId", "meetingId") REFERENCES "Meeting"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MeetingStudent" ADD CONSTRAINT "MeetingStudent_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Carry the old slot-booking PTMs over as invitation meetings for the same
-- sections' parents and teachers. A draft PTM was never shown to anyone, so it
-- arrives cancelled rather than suddenly appearing in portals. Booked slots and
-- teachers' slot notes belong to the booking workflow that is retired here and
-- are not carried over.
INSERT INTO "Meeting" ("id", "schoolId", "academicSessionId", "type", "title", "description", "date", "startMinute", "endMinute", "audiences", "scope", "status", "cancelledAt", "cancelReason", "createdAt", "updatedAt")
SELECT "id", "schoolId", "academicSessionId", 'PTM', "title", "notes", "date", "startMinute", "endMinute",
       ARRAY['PARENTS', 'TEACHERS']::"MeetingAudience"[], 'SECTIONS',
       CASE WHEN "status" = 'DRAFT' THEN 'CANCELLED'::"MeetingStatus" ELSE 'SCHEDULED'::"MeetingStatus" END,
       CASE WHEN "status" = 'DRAFT' THEN "updatedAt" END,
       CASE WHEN "status" = 'DRAFT' THEN 'Draft PTM that was never opened.' END,
       "createdAt", "updatedAt"
FROM "Ptm";

INSERT INTO "MeetingSection" ("id", "schoolId", "meetingId", "sectionId")
SELECT "id", "schoolId", "ptmId", "sectionId" FROM "PtmSection";

-- A meeting ends after it starts, is for at least one audience, and "ALL"
-- stands alone rather than beside the groups it already covers.
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_window_check" CHECK ("endMinute" IS NULL OR "endMinute" > "startMinute");
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_time_range_check" CHECK ("startMinute" BETWEEN 0 AND 1439 AND ("endMinute" IS NULL OR "endMinute" BETWEEN 1 AND 1440));
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_audiences_check" CHECK (cardinality("audiences") > 0 AND (NOT ('ALL' = ANY ("audiences")) OR cardinality("audiences") = 1));
-- A cancelled meeting records when; a scheduled one does not.
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_cancel_check" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

-- DropForeignKey
ALTER TABLE "Ptm" DROP CONSTRAINT "Ptm_schoolId_academicSessionId_fkey";

-- DropForeignKey
ALTER TABLE "Ptm" DROP CONSTRAINT "Ptm_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "PtmSection" DROP CONSTRAINT "PtmSection_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "PtmSection" DROP CONSTRAINT "PtmSection_schoolId_ptmId_fkey";

-- DropForeignKey
ALTER TABLE "PtmSection" DROP CONSTRAINT "PtmSection_schoolId_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "PtmSlot" DROP CONSTRAINT "PtmSlot_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "PtmSlot" DROP CONSTRAINT "PtmSlot_schoolId_parentId_fkey";

-- DropForeignKey
ALTER TABLE "PtmSlot" DROP CONSTRAINT "PtmSlot_schoolId_ptmId_fkey";

-- DropForeignKey
ALTER TABLE "PtmSlot" DROP CONSTRAINT "PtmSlot_schoolId_studentId_fkey";

-- DropForeignKey
ALTER TABLE "PtmSlot" DROP CONSTRAINT "PtmSlot_schoolId_teacherId_fkey";

-- DropTable
DROP TABLE "Ptm";

-- DropTable
DROP TABLE "PtmSection";

-- DropTable
DROP TABLE "PtmSlot";

-- DropEnum
DROP TYPE "PtmSlotStatus";

-- DropEnum
DROP TYPE "PtmStatus";
