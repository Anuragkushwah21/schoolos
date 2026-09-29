-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "examId" TEXT,
ADD COLUMN     "passMarks" INTEGER;

-- AlterTable
ALTER TABLE "AssessmentResult" ADD COLUMN     "absent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exam_schoolId_academicSessionId_status_idx" ON "Exam"("schoolId", "academicSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_schoolId_id_key" ON "Exam"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_schoolId_academicSessionId_sectionId_name_key" ON "Exam"("schoolId", "academicSessionId", "sectionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_schoolId_examId_subjectId_key" ON "Assessment"("schoolId", "examId", "subjectId");

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_examId_fkey" FOREIGN KEY ("schoolId", "examId") REFERENCES "Exam"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- An exam cannot end before it starts.
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_date_range_check" CHECK ("endDate" >= "startDate");
-- Marks are never negative, and an absent student has no mark.
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_marks_check" CHECK ("marksObtained" IS NULL OR "marksObtained" >= 0);
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_absent_check" CHECK (NOT "absent" OR "marksObtained" IS NULL);
