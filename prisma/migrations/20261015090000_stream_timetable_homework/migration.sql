-- DropIndex
DROP INDEX "TimetableSlot_schoolId_academicSessionId_sectionId_dayOfWee_key";

-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "streamId" TEXT;

-- AlterTable
ALTER TABLE "TimetableSlot" ADD COLUMN     "streamId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSlot_schoolId_academicSessionId_sectionId_streamId_key" ON "TimetableSlot"("schoolId", "academicSessionId", "sectionId", "streamId", "dayOfWeek", "startMinute");

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_schoolId_streamId_fkey" FOREIGN KEY ("schoolId", "streamId") REFERENCES "Stream"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_schoolId_streamId_fkey" FOREIGN KEY ("schoolId", "streamId") REFERENCES "Stream"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

