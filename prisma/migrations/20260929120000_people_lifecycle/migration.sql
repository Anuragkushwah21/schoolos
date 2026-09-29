-- CreateEnum
CREATE TYPE "LoginDisabledReason" AS ENUM ('ADMIN', 'STATUS');

-- CreateEnum
CREATE TYPE "PersonKind" AS ENUM ('STUDENT', 'PARENT', 'TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "StatusChangeKind" AS ENUM ('STATUS', 'LOGIN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StudentStatus" ADD VALUE 'ON_LEAVE';
ALTER TYPE "StudentStatus" ADD VALUE 'WITHDRAWN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TeacherStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "TeacherStatus" ADD VALUE 'RESIGNED';
ALTER TYPE "TeacherStatus" ADD VALUE 'TERMINATED';
ALTER TYPE "TeacherStatus" ADD VALUE 'RETIRED';
ALTER TYPE "TeacherStatus" ADD VALUE 'TRANSFERRED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledReason" "LoginDisabledReason";

-- CreateTable
CREATE TABLE "StatusChange" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "person" "PersonKind" NOT NULL,
    "kind" "StatusChangeKind" NOT NULL,
    "studentId" TEXT,
    "parentId" TEXT,
    "teacherId" TEXT,
    "staffMemberId" TEXT,
    "fromValue" TEXT NOT NULL,
    "toValue" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT,
    "remarks" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatusChange_schoolId_studentId_createdAt_idx" ON "StatusChange"("schoolId", "studentId", "createdAt");

-- CreateIndex
CREATE INDEX "StatusChange_schoolId_teacherId_createdAt_idx" ON "StatusChange"("schoolId", "teacherId", "createdAt");

-- CreateIndex
CREATE INDEX "StatusChange_schoolId_staffMemberId_createdAt_idx" ON "StatusChange"("schoolId", "staffMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "StatusChange_schoolId_parentId_createdAt_idx" ON "StatusChange"("schoolId", "parentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatusChange_schoolId_id_key" ON "StatusChange"("schoolId", "id");

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_schoolId_parentId_fkey" FOREIGN KEY ("schoolId", "parentId") REFERENCES "Parent"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_schoolId_staffMemberId_fkey" FOREIGN KEY ("schoolId", "staffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Logins that are already closed get a reason. One closed because the person
-- left (a student not ACTIVE, a teacher or staff member INACTIVE — the only
-- statuses that closed logins before) reopens if they return; any other was
-- the office's own decision and stays closed. Only values that existed before
-- this migration are compared, as enum values added above cannot be used in
-- the same transaction.
UPDATE "User" u SET "disabledReason" = 'STATUS', "disabledAt" = u."updatedAt"
WHERE u."isActive" = false AND (
  EXISTS (SELECT 1 FROM "Student" s WHERE s."userId" = u.id AND s."status" <> 'ACTIVE')
  OR EXISTS (SELECT 1 FROM "Teacher" t WHERE t."userId" = u.id AND t."status" = 'INACTIVE')
  OR EXISTS (SELECT 1 FROM "StaffMember" m WHERE m."userId" = u.id AND m."status" = 'INACTIVE')
);
UPDATE "User" SET "disabledReason" = 'ADMIN', "disabledAt" = "updatedAt" WHERE "isActive" = false AND "disabledReason" IS NULL;

-- A status change names exactly one person.
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_one_person_check" CHECK (
  num_nonnulls("studentId", "parentId", "teacherId", "staffMemberId") = 1
);
