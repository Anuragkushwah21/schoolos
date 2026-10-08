-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'HALF_DAY';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "attendanceHalfDay" BOOLEAN NOT NULL DEFAULT true;

