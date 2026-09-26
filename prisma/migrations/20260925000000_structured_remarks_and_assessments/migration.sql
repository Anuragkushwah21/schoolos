-- CreateEnum
CREATE TYPE "RemarkLevel" AS ENUM ('GOOD', 'AVERAGE', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "HomeworkHabit" AS ENUM ('REGULAR', 'SOMETIMES_MISSING', 'FREQUENTLY_MISSING');

-- CreateEnum
CREATE TYPE "ParticipationLevel" AS ENUM ('ACTIVE', 'AVERAGE', 'NEEDS_IMPROVEMENT');

-- AlterTable
--
-- A remark gains three structured bands, and its prose becomes optional: the
-- bands can now stand on their own. Existing rows keep their text and answer
-- none of the three, which is exactly what they were.
ALTER TABLE "StudentRemark" ADD COLUMN     "understanding" "RemarkLevel",
ADD COLUMN     "homeworkHabit" "HomeworkHabit",
ADD COLUMN     "participation" "ParticipationLevel",
ALTER COLUMN "body" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "maxMarks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "marksObtained" INTEGER,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_schoolId_id_key" ON "Assessment"("schoolId", "id");

-- CreateIndex
CREATE INDEX "Assessment_schoolId_academicSessionId_sectionId_date_idx" ON "Assessment"("schoolId", "academicSessionId", "sectionId", "date");

-- CreateIndex
CREATE INDEX "Assessment_schoolId_subjectId_date_idx" ON "Assessment"("schoolId", "subjectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResult_schoolId_id_key" ON "AssessmentResult"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResult_schoolId_assessmentId_studentId_key" ON "AssessmentResult"("schoolId", "assessmentId", "studentId");

-- CreateIndex
CREATE INDEX "AssessmentResult_schoolId_studentId_idx" ON "AssessmentResult"("schoolId", "studentId");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_subjectId_fkey" FOREIGN KEY ("schoolId", "subjectId") REFERENCES "Subject"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_schoolId_assessmentId_fkey" FOREIGN KEY ("schoolId", "assessmentId") REFERENCES "Assessment"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
