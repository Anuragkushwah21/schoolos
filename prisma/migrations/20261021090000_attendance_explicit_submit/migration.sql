-- AlterTable
ALTER TABLE "School" ALTER COLUMN "attendanceSubmission" SET DEFAULT 'MANUAL';


-- Attendance is final only when the teacher submits it: no school submits drafts automatically any more,
-- and no waiting draft keeps an automatic submission time. Submitted registers are untouched.
UPDATE "School" SET "attendanceSubmission" = 'MANUAL' WHERE "attendanceSubmission" = 'AUTO';
UPDATE "AttendanceRegister" SET "finalizeAt" = NULL WHERE "status" = 'DRAFT' AND "finalizeAt" IS NOT NULL;
