-- AlterTable
ALTER TABLE "School" ADD COLUMN     "attendanceAttentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "attendanceAttentionPercent" INTEGER NOT NULL DEFAULT 75;

