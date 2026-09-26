-- CreateEnum
CREATE TYPE "LessonMaterialKind" AS ENUM ('NOTES', 'LINK', 'DOCUMENT', 'QUESTIONS', 'PRACTICE');

-- AlterTable
--
-- A lesson gains the three fields that make it useful before and after it is
-- taught: what the teacher plans to cover, what students should do first, and
-- the short list they revise from. The same row carries all of it, so there is
-- no separate lesson-plan table to keep in step with the register.
ALTER TABLE "ClassSession" ADD COLUMN     "plannedTopic" TEXT,
ADD COLUMN     "preparation" TEXT,
ADD COLUMN     "importantPoints" TEXT;

-- CreateTable
CREATE TABLE "LessonMaterial" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "kind" "LessonMaterialKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LessonMaterial_schoolId_id_key" ON "LessonMaterial"("schoolId", "id");

-- CreateIndex
CREATE INDEX "LessonMaterial_schoolId_classSessionId_idx" ON "LessonMaterial"("schoolId", "classSessionId");

-- AddForeignKey
ALTER TABLE "LessonMaterial" ADD CONSTRAINT "LessonMaterial_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonMaterial" ADD CONSTRAINT "LessonMaterial_schoolId_classSessionId_fkey" FOREIGN KEY ("schoolId", "classSessionId") REFERENCES "ClassSession"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
