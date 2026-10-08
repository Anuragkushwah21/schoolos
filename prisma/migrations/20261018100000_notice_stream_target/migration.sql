-- A STREAM notice names a stream and nothing else; every other scope names no stream.
ALTER TABLE "Notice" DROP CONSTRAINT "Notice_scope_target_check";
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_scope_target_check" CHECK (
  ("scope" = 'CLASS' AND "classId" IS NOT NULL AND "sectionId" IS NULL AND "streamId" IS NULL) OR
  ("scope" = 'SECTION' AND "sectionId" IS NOT NULL AND "classId" IS NULL AND "streamId" IS NULL) OR
  ("scope" = 'STREAM' AND "streamId" IS NOT NULL AND "classId" IS NULL AND "sectionId" IS NULL) OR
  ("scope" IN ('SCHOOL', 'STUDENTS') AND "classId" IS NULL AND "sectionId" IS NULL AND "streamId" IS NULL)
);
