-- CreateEnum
CREATE TYPE "NoticeScope" AS ENUM ('SCHOOL', 'CLASS', 'SECTION', 'STUDENTS');

-- AlterTable
ALTER TABLE "Notice" ADD COLUMN     "classId" TEXT,
ADD COLUMN     "scope" "NoticeScope" NOT NULL DEFAULT 'SCHOOL',
ADD COLUMN     "sectionId" TEXT;

-- CreateTable
CREATE TABLE "NoticeRecipient" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "NoticeRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoticeRecipient_schoolId_studentId_idx" ON "NoticeRecipient"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeRecipient_schoolId_id_key" ON "NoticeRecipient"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeRecipient_schoolId_noticeId_studentId_key" ON "NoticeRecipient"("schoolId", "noticeId", "studentId");

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_schoolId_classId_fkey" FOREIGN KEY ("schoolId", "classId") REFERENCES "Class"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NoticeRecipient" ADD CONSTRAINT "NoticeRecipient_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRecipient" ADD CONSTRAINT "NoticeRecipient_schoolId_noticeId_fkey" FOREIGN KEY ("schoolId", "noticeId") REFERENCES "Notice"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NoticeRecipient" ADD CONSTRAINT "NoticeRecipient_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- A class notice names a class, a section notice a section, and nothing else.
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_scope_target_check" CHECK (
  ("scope" = 'CLASS' AND "classId" IS NOT NULL AND "sectionId" IS NULL) OR
  ("scope" = 'SECTION' AND "sectionId" IS NOT NULL AND "classId" IS NULL) OR
  ("scope" IN ('SCHOOL', 'STUDENTS') AND "classId" IS NULL AND "sectionId" IS NULL)
);
