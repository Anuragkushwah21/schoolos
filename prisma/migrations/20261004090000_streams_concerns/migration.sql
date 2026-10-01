-- Stream seat allocation, stream-aware subject assignments, and subject-wise
-- parent–teacher concerns with a conversation thread.
--
-- Existing data is kept: every existing concern is numbered, typed from its
-- old reason, given its placement at the time, and its message and reply
-- become the first messages of its thread before the old columns go.

-- -----------------------------------------------------------------------------
-- Concern status: NEW → OPEN, REVIEWING / ACTION_TAKEN → IN_PROGRESS.
-- -----------------------------------------------------------------------------
CREATE TYPE "ConcernType" AS ENUM ('ACADEMIC', 'TOPIC_DIFFICULTY', 'HOMEWORK', 'ATTENDANCE', 'PARTICIPATION', 'EXTRA_SUPPORT', 'IMPROVEMENT_SUGGESTION', 'POSITIVE_FEEDBACK', 'OTHER');

CREATE TYPE "ConcernStatus_new" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
ALTER TABLE "SupportConcern" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SupportConcern" ALTER COLUMN "status" TYPE "ConcernStatus_new" USING (
  CASE "status"::text
    WHEN 'NEW' THEN 'OPEN'
    WHEN 'REVIEWING' THEN 'IN_PROGRESS'
    WHEN 'ACTION_TAKEN' THEN 'IN_PROGRESS'
    ELSE 'RESOLVED'
  END
)::"ConcernStatus_new";
ALTER TYPE "ConcernStatus" RENAME TO "ConcernStatus_old";
ALTER TYPE "ConcernStatus_new" RENAME TO "ConcernStatus";
DROP TYPE "ConcernStatus_old";
ALTER TABLE "SupportConcern" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- -----------------------------------------------------------------------------
-- Concerns: new columns, backfilled.
-- -----------------------------------------------------------------------------
ALTER TABLE "School" ADD COLUMN "lastConcernNumber" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SupportConcern"
  ADD COLUMN "number" INTEGER,
  ADD COLUMN "raisedBy" "SupportSource",
  ADD COLUMN "type" "ConcernType",
  ADD COLUMN "priority" "SupportPriority" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "academicSessionId" TEXT,
  ADD COLUMN "classId" TEXT,
  ADD COLUMN "sectionId" TEXT,
  ADD COLUMN "streamId" TEXT,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updateRequestedAt" TIMESTAMP(3),
  ADD COLUMN "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ALTER COLUMN "parentId" DROP NOT NULL;

-- Numbered per school in the order they were raised.
UPDATE "SupportConcern" c SET "number" = n.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "schoolId" ORDER BY "createdAt", "id") AS rn FROM "SupportConcern") n
WHERE c."id" = n."id";

UPDATE "School" s SET "lastConcernNumber" = m.max_number
FROM (SELECT "schoolId", MAX("number") AS max_number FROM "SupportConcern" GROUP BY "schoolId") m
WHERE s."id" = m."schoolId";

-- Every existing concern was raised by a parent.
UPDATE "SupportConcern" c SET
  "raisedBy" = 'PARENT',
  "type" = (CASE c."reason"::text
    WHEN 'DIFFICULTY_UNDERSTANDING' THEN 'TOPIC_DIFFICULTY'
    WHEN 'LOW_TEST_PERFORMANCE' THEN 'ACADEMIC'
    WHEN 'LEARNING_GAP' THEN 'ACADEMIC'
    WHEN 'HOMEWORK_INCOMPLETE' THEN 'HOMEWORK'
    WHEN 'LOW_PARTICIPATION' THEN 'PARTICIPATION'
    WHEN 'ATTENDANCE' THEN 'ATTENDANCE'
    WHEN 'NEEDS_PRACTICE' THEN 'EXTRA_SUPPORT'
    WHEN 'NEEDS_REVISION' THEN 'EXTRA_SUPPORT'
    ELSE 'OTHER'
  END)::"ConcernType",
  "createdById" = p."userId",
  "lastMessageAt" = COALESCE(c."reviewedAt", c."createdAt"),
  "closedAt" = NULL
FROM "Parent" p
WHERE p."schoolId" = c."schoolId" AND p."id" = c."parentId";

-- Placement when raised: the enrollment whose session covers that day.
UPDATE "SupportConcern" c SET
  "academicSessionId" = e."academicSessionId",
  "classId" = e."classId",
  "sectionId" = e."sectionId",
  "streamId" = COALESCE(e."streamId", sec."streamId")
FROM "StudentEnrollment" e
JOIN "AcademicSession" a ON a."schoolId" = e."schoolId" AND a."id" = e."academicSessionId"
JOIN "Section" sec ON sec."schoolId" = e."schoolId" AND sec."id" = e."sectionId"
WHERE e."schoolId" = c."schoolId" AND e."studentId" = c."studentId"
  AND c."createdAt"::date BETWEEN a."startDate" AND a."endDate";

-- -----------------------------------------------------------------------------
-- The conversation.
-- -----------------------------------------------------------------------------
CREATE TABLE "ConcernMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "concernId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorRole" "SupportSource" NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "fromStatus" "ConcernStatus",
    "toStatus" "ConcernStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConcernMessage_pkey" PRIMARY KEY ("id")
);

-- The parent's original message (or a line saying they raised it).
INSERT INTO "ConcernMessage" ("id", "schoolId", "concernId", "authorId", "authorRole", "body", "createdAt")
SELECT gen_random_uuid()::text, c."schoolId", c."id", c."createdById", 'PARENT',
       COALESCE(NULLIF(TRIM(c."message"), ''), 'Raised a concern.'), c."createdAt"
FROM "SupportConcern" c;

-- The school's reply, if there was one. Who wrote it was not recorded.
INSERT INTO "ConcernMessage" ("id", "schoolId", "concernId", "authorId", "authorRole", "body", "toStatus", "createdAt")
SELECT gen_random_uuid()::text, c."schoolId", c."id", NULL,
       (CASE WHEN c."teacherId" IS NULL THEN 'SCHOOL_ADMIN' ELSE 'TEACHER' END)::"SupportSource",
       c."response", c."status", COALESCE(c."reviewedAt", c."updatedAt")
FROM "SupportConcern" c
WHERE NULLIF(TRIM(c."response"), '') IS NOT NULL;

ALTER TABLE "SupportConcern"
  ALTER COLUMN "number" SET NOT NULL,
  ALTER COLUMN "raisedBy" SET NOT NULL,
  ALTER COLUMN "type" SET NOT NULL,
  DROP COLUMN "message",
  DROP COLUMN "reason",
  DROP COLUMN "response";

-- -----------------------------------------------------------------------------
-- Stream-aware subject assignments. The old five-column key is a subset of
-- the new six-column one, so no existing row can conflict.
-- -----------------------------------------------------------------------------
ALTER TABLE "TeacherSubjectAssignment" ADD COLUMN "streamId" TEXT;
DROP INDEX "TeacherSubjectAssignment_schoolId_academicSessionId_teacher_key";
CREATE UNIQUE INDEX "TeacherSubjectAssignment_schoolId_academicSessionId_teacher_key" ON "TeacherSubjectAssignment"("schoolId", "academicSessionId", "teacherId", "subjectId", "sectionId", "streamId");

-- -----------------------------------------------------------------------------
-- A stream's share of a section's seats.
-- -----------------------------------------------------------------------------
CREATE TABLE "SectionStream" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionStream_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SectionStream_capacity_check" CHECK ("capacity" >= 0)
);

-- -----------------------------------------------------------------------------
-- Indexes and keys.
-- -----------------------------------------------------------------------------
CREATE INDEX "ConcernMessage_schoolId_concernId_createdAt_idx" ON "ConcernMessage"("schoolId", "concernId", "createdAt");
CREATE UNIQUE INDEX "ConcernMessage_schoolId_id_key" ON "ConcernMessage"("schoolId", "id");
CREATE INDEX "SectionStream_schoolId_streamId_idx" ON "SectionStream"("schoolId", "streamId");
CREATE UNIQUE INDEX "SectionStream_schoolId_id_key" ON "SectionStream"("schoolId", "id");
CREATE UNIQUE INDEX "SectionStream_schoolId_sectionId_streamId_key" ON "SectionStream"("schoolId", "sectionId", "streamId");
CREATE UNIQUE INDEX "SupportConcern_schoolId_number_key" ON "SupportConcern"("schoolId", "number");

ALTER TABLE "SupportConcern" DROP CONSTRAINT "SupportConcern_schoolId_parentId_fkey";
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_parentId_fkey" FOREIGN KEY ("schoolId", "parentId") REFERENCES "Parent"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_classId_fkey" FOREIGN KEY ("schoolId", "classId") REFERENCES "Class"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_streamId_fkey" FOREIGN KEY ("schoolId", "streamId") REFERENCES "Stream"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConcernMessage" ADD CONSTRAINT "ConcernMessage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConcernMessage" ADD CONSTRAINT "ConcernMessage_schoolId_concernId_fkey" FOREIGN KEY ("schoolId", "concernId") REFERENCES "SupportConcern"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ConcernMessage" ADD CONSTRAINT "ConcernMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SectionStream" ADD CONSTRAINT "SectionStream_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SectionStream" ADD CONSTRAINT "SectionStream_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SectionStream" ADD CONSTRAINT "SectionStream_schoolId_streamId_fkey" FOREIGN KEY ("schoolId", "streamId") REFERENCES "Stream"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeacherSubjectAssignment" ADD CONSTRAINT "TeacherSubjectAssignment_schoolId_streamId_fkey" FOREIGN KEY ("schoolId", "streamId") REFERENCES "Stream"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
