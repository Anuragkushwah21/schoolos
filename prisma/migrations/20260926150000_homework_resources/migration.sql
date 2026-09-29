-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "instructions" TEXT;

-- AlterTable
ALTER TABLE "LessonMaterial" ADD COLUMN     "homeworkId" TEXT,
ALTER COLUMN "classSessionId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "LessonMaterial_schoolId_homeworkId_idx" ON "LessonMaterial"("schoolId", "homeworkId");

-- AddForeignKey
ALTER TABLE "LessonMaterial" ADD CONSTRAINT "LessonMaterial_schoolId_homeworkId_fkey" FOREIGN KEY ("schoolId", "homeworkId") REFERENCES "Homework"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- A resource belongs to a completed class or to a homework, never both and
-- never neither. Prisma cannot express this, so it lives here.
ALTER TABLE "LessonMaterial" ADD CONSTRAINT "LessonMaterial_exactly_one_owner"
  CHECK (("classSessionId" IS NULL) <> ("homeworkId" IS NULL));
