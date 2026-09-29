-- CreateEnum
CREATE TYPE "SupportSource" AS ENUM ('TEACHER', 'PARENT', 'SCHOOL_ADMIN');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('NEW', 'REVIEWING', 'SUPPORT_PLANNED', 'IN_PROGRESS', 'IMPROVING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SupportReason" AS ENUM ('DIFFICULTY_UNDERSTANDING', 'LOW_TEST_PERFORMANCE', 'HOMEWORK_INCOMPLETE', 'LOW_PARTICIPATION', 'ATTENDANCE', 'NEEDS_PRACTICE', 'NEEDS_REVISION', 'LEARNING_GAP', 'PARENT_CONCERN', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportAction" AS ENUM ('EXTRA_PRACTICE', 'STUDY_MATERIAL', 'REVISION', 'EXTRA_CLASS', 'ONE_TO_ONE', 'HOMEWORK_SUPPORT', 'PARENT_DISCUSSION', 'MONITOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ConcernStatus" AS ENUM ('NEW', 'REVIEWING', 'ACTION_TAKEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "StudentSupport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT,
    "teacherId" TEXT,
    "source" "SupportSource" NOT NULL,
    "reason" "SupportReason" NOT NULL,
    "reasonNote" TEXT,
    "topic" TEXT,
    "priority" "SupportPriority" NOT NULL DEFAULT 'MEDIUM',
    "action" "SupportAction" NOT NULL,
    "actionNote" TEXT,
    "status" "SupportStatus" NOT NULL DEFAULT 'NEW',
    "concernId" TEXT,
    "extraClassMeetingId" TEXT,
    "createdById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentSupport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "supportId" TEXT NOT NULL,
    "authorId" TEXT,
    "note" TEXT NOT NULL,
    "fromStatus" "SupportStatus",
    "toStatus" "SupportStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConcern" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "subjectId" TEXT,
    "teacherId" TEXT,
    "reason" "SupportReason" NOT NULL,
    "message" TEXT,
    "status" "ConcernStatus" NOT NULL DEFAULT 'NEW',
    "response" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConcern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentSupport_schoolId_status_createdAt_idx" ON "StudentSupport"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StudentSupport_schoolId_studentId_idx" ON "StudentSupport"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "StudentSupport_schoolId_teacherId_status_idx" ON "StudentSupport"("schoolId", "teacherId", "status");

-- CreateIndex
CREATE INDEX "StudentSupport_schoolId_sectionId_idx" ON "StudentSupport"("schoolId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSupport_schoolId_id_key" ON "StudentSupport"("schoolId", "id");

-- CreateIndex
CREATE INDEX "SupportNote_schoolId_supportId_createdAt_idx" ON "SupportNote"("schoolId", "supportId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportNote_schoolId_id_key" ON "SupportNote"("schoolId", "id");

-- CreateIndex
CREATE INDEX "SupportConcern_schoolId_status_createdAt_idx" ON "SupportConcern"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportConcern_schoolId_teacherId_status_idx" ON "SupportConcern"("schoolId", "teacherId", "status");

-- CreateIndex
CREATE INDEX "SupportConcern_schoolId_studentId_idx" ON "SupportConcern"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportConcern_schoolId_id_key" ON "SupportConcern"("schoolId", "id");

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_classId_fkey" FOREIGN KEY ("schoolId", "classId") REFERENCES "Class"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_subjectId_fkey" FOREIGN KEY ("schoolId", "subjectId") REFERENCES "Subject"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_concernId_fkey" FOREIGN KEY ("schoolId", "concernId") REFERENCES "SupportConcern"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_schoolId_extraClassMeetingId_fkey" FOREIGN KEY ("schoolId", "extraClassMeetingId") REFERENCES "Meeting"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNote" ADD CONSTRAINT "SupportNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNote" ADD CONSTRAINT "SupportNote_schoolId_supportId_fkey" FOREIGN KEY ("schoolId", "supportId") REFERENCES "StudentSupport"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SupportNote" ADD CONSTRAINT "SupportNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_parentId_fkey" FOREIGN KEY ("schoolId", "parentId") REFERENCES "Parent"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_subjectId_fkey" FOREIGN KEY ("schoolId", "subjectId") REFERENCES "Subject"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SupportConcern" ADD CONSTRAINT "SupportConcern_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- A resolved record carries when it was resolved; an open one does not.
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_resolved_check" CHECK (("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL));
