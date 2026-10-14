-- CreateEnum
CREATE TYPE "SyllabusLevel" AS ENUM ('UNIT', 'CHAPTER', 'TOPIC');

-- CreateEnum
CREATE TYPE "TopicCoverage" AS ENUM ('COVERED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "AcademicReviewKind" AS ENUM ('UNIT_READY', 'LOW_PERFORMANCE', 'NOTE');

-- CreateEnum
CREATE TYPE "AcademicReviewStatus" AS ENUM ('OPEN', 'UPDATE_REQUESTED', 'REVISION_RECOMMENDED', 'REVISION_PLANNED', 'REVISION_DONE', 'RESOLVED');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "syllabusItemId" TEXT;

-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "syllabusItemId" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "academicReviewPercent" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "SyllabusItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "level" "SyllabusLevel" NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "plannedFrom" DATE,
    "plannedTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyllabusItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonTopic" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "coverage" "TopicCoverage" NOT NULL DEFAULT 'COVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicReview" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" "AcademicReviewKind" NOT NULL,
    "status" "AcademicReviewStatus" NOT NULL DEFAULT 'OPEN',
    "syllabusItemId" TEXT,
    "assessmentId" TEXT,
    "note" TEXT,
    "teacherResponse" TEXT,
    "revisionPlannedOn" DATE,
    "revisionSessionId" TEXT,
    "followUpAssessmentId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyllabusItem_schoolId_academicSessionId_classId_subjectId_idx" ON "SyllabusItem"("schoolId", "academicSessionId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "SyllabusItem_schoolId_parentId_idx" ON "SyllabusItem"("schoolId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "SyllabusItem_schoolId_id_key" ON "SyllabusItem"("schoolId", "id");

-- CreateIndex
CREATE INDEX "LessonTopic_schoolId_topicId_idx" ON "LessonTopic"("schoolId", "topicId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonTopic_schoolId_id_key" ON "LessonTopic"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LessonTopic_schoolId_classSessionId_topicId_key" ON "LessonTopic"("schoolId", "classSessionId", "topicId");

-- CreateIndex
CREATE INDEX "AcademicReview_schoolId_sectionId_subjectId_status_idx" ON "AcademicReview"("schoolId", "sectionId", "subjectId", "status");

-- CreateIndex
CREATE INDEX "AcademicReview_schoolId_academicSessionId_status_idx" ON "AcademicReview"("schoolId", "academicSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicReview_schoolId_id_key" ON "AcademicReview"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicReview_schoolId_kind_assessmentId_key" ON "AcademicReview"("schoolId", "kind", "assessmentId");

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_schoolId_syllabusItemId_fkey" FOREIGN KEY ("schoolId", "syllabusItemId") REFERENCES "SyllabusItem"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SyllabusItem" ADD CONSTRAINT "SyllabusItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusItem" ADD CONSTRAINT "SyllabusItem_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SyllabusItem" ADD CONSTRAINT "SyllabusItem_schoolId_classId_fkey" FOREIGN KEY ("schoolId", "classId") REFERENCES "Class"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SyllabusItem" ADD CONSTRAINT "SyllabusItem_schoolId_subjectId_fkey" FOREIGN KEY ("schoolId", "subjectId") REFERENCES "Subject"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SyllabusItem" ADD CONSTRAINT "SyllabusItem_schoolId_parentId_fkey" FOREIGN KEY ("schoolId", "parentId") REFERENCES "SyllabusItem"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "LessonTopic" ADD CONSTRAINT "LessonTopic_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonTopic" ADD CONSTRAINT "LessonTopic_schoolId_classSessionId_fkey" FOREIGN KEY ("schoolId", "classSessionId") REFERENCES "ClassSession"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "LessonTopic" ADD CONSTRAINT "LessonTopic_schoolId_topicId_fkey" FOREIGN KEY ("schoolId", "topicId") REFERENCES "SyllabusItem"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AcademicReview" ADD CONSTRAINT "AcademicReview_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicReview" ADD CONSTRAINT "AcademicReview_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AcademicReview" ADD CONSTRAINT "AcademicReview_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AcademicReview" ADD CONSTRAINT "AcademicReview_schoolId_subjectId_fkey" FOREIGN KEY ("schoolId", "subjectId") REFERENCES "Subject"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AcademicReview" ADD CONSTRAINT "AcademicReview_schoolId_syllabusItemId_fkey" FOREIGN KEY ("schoolId", "syllabusItemId") REFERENCES "SyllabusItem"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AcademicReview" ADD CONSTRAINT "AcademicReview_schoolId_assessmentId_fkey" FOREIGN KEY ("schoolId", "assessmentId") REFERENCES "Assessment"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AcademicReview" ADD CONSTRAINT "AcademicReview_schoolId_followUpAssessmentId_fkey" FOREIGN KEY ("schoolId", "followUpAssessmentId") REFERENCES "Assessment"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AcademicReview" ADD CONSTRAINT "AcademicReview_schoolId_revisionSessionId_fkey" FOREIGN KEY ("schoolId", "revisionSessionId") REFERENCES "ClassSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_syllabusItemId_fkey" FOREIGN KEY ("schoolId", "syllabusItemId") REFERENCES "SyllabusItem"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

