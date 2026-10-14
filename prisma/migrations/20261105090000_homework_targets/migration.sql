-- CreateEnum
CREATE TYPE "HomeworkAudience" AS ENUM ('SECTION', 'SELECTED_STUDENTS');

-- CreateEnum
CREATE TYPE "HomeworkSubmissionStatus" AS ENUM ('SUBMITTED', 'LATE', 'MISSING');

-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "audience" "HomeworkAudience" NOT NULL DEFAULT 'SECTION';

-- CreateTable
CREATE TABLE "HomeworkStudent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "homeworkId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeworkStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeworkSubmission" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "homeworkId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "HomeworkSubmissionStatus" NOT NULL,
    "note" TEXT,
    "markedByUserId" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeworkSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeworkStudent_schoolId_studentId_idx" ON "HomeworkStudent"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkStudent_schoolId_id_key" ON "HomeworkStudent"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkStudent_schoolId_homeworkId_studentId_key" ON "HomeworkStudent"("schoolId", "homeworkId", "studentId");

-- CreateIndex
CREATE INDEX "HomeworkSubmission_schoolId_studentId_idx" ON "HomeworkSubmission"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkSubmission_schoolId_id_key" ON "HomeworkSubmission"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkSubmission_schoolId_homeworkId_studentId_key" ON "HomeworkSubmission"("schoolId", "homeworkId", "studentId");

-- AddForeignKey
ALTER TABLE "HomeworkStudent" ADD CONSTRAINT "HomeworkStudent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkStudent" ADD CONSTRAINT "HomeworkStudent_schoolId_homeworkId_fkey" FOREIGN KEY ("schoolId", "homeworkId") REFERENCES "Homework"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HomeworkStudent" ADD CONSTRAINT "HomeworkStudent_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_schoolId_homeworkId_fkey" FOREIGN KEY ("schoolId", "homeworkId") REFERENCES "Homework"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

