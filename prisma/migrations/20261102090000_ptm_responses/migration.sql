-- CreateEnum
CREATE TYPE "PtmResponse" AS ENUM ('WILL_ATTEND', 'UNABLE_TO_ATTEND');

-- CreateEnum
CREATE TYPE "PtmAttendance" AS ENUM ('ATTENDED', 'DID_NOT_ATTEND', 'RESCHEDULED');

-- CreateTable
CREATE TABLE "PtmFamily" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "response" "PtmResponse",
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "attendance" "PtmAttendance",
    "remarks" TEXT,
    "followUp" TEXT,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtmFamily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtmFamily_schoolId_studentId_idx" ON "PtmFamily"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "PtmFamily_schoolId_id_key" ON "PtmFamily"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PtmFamily_schoolId_meetingId_studentId_key" ON "PtmFamily"("schoolId", "meetingId", "studentId");

-- AddForeignKey
ALTER TABLE "PtmFamily" ADD CONSTRAINT "PtmFamily_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtmFamily" ADD CONSTRAINT "PtmFamily_schoolId_meetingId_fkey" FOREIGN KEY ("schoolId", "meetingId") REFERENCES "Meeting"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PtmFamily" ADD CONSTRAINT "PtmFamily_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

