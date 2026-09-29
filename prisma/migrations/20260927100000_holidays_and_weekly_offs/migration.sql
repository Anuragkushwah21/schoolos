-- AlterTable
ALTER TABLE "School" ADD COLUMN     "weeklyOffDays" "DayOfWeek"[] DEFAULT ARRAY['SUNDAY']::"DayOfWeek"[];

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Holiday_schoolId_startDate_idx" ON "Holiday"("schoolId", "startDate");

-- CreateIndex
CREATE INDEX "Holiday_schoolId_endDate_idx" ON "Holiday"("schoolId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_schoolId_id_key" ON "Holiday"("schoolId", "id");

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A holiday cannot end before it starts. The app validates this too; the
-- database keeps it true for every writer.
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_date_range_check" CHECK ("endDate" >= "startDate");
