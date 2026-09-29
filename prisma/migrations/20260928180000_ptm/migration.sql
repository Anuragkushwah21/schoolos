-- CreateEnum
CREATE TYPE "PtmStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PtmSlotStatus" AS ENUM ('OPEN', 'BOOKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Ptm" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "slotMinutes" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "PtmStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ptm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtmSection" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "ptmId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,

    CONSTRAINT "PtmSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtmSlot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "ptmId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "status" "PtmSlotStatus" NOT NULL DEFAULT 'OPEN',
    "studentId" TEXT,
    "parentId" TEXT,
    "bookedAt" TIMESTAMP(3),
    "teacherRemark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtmSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ptm_schoolId_date_idx" ON "Ptm"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Ptm_schoolId_id_key" ON "Ptm"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PtmSection_schoolId_id_key" ON "PtmSection"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PtmSection_schoolId_ptmId_sectionId_key" ON "PtmSection"("schoolId", "ptmId", "sectionId");

-- CreateIndex
CREATE INDEX "PtmSlot_schoolId_ptmId_parentId_idx" ON "PtmSlot"("schoolId", "ptmId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "PtmSlot_schoolId_id_key" ON "PtmSlot"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PtmSlot_schoolId_ptmId_teacherId_startMinute_key" ON "PtmSlot"("schoolId", "ptmId", "teacherId", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "PtmSlot_schoolId_ptmId_teacherId_studentId_key" ON "PtmSlot"("schoolId", "ptmId", "teacherId", "studentId");

-- AddForeignKey
ALTER TABLE "Ptm" ADD CONSTRAINT "Ptm_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ptm" ADD CONSTRAINT "Ptm_schoolId_academicSessionId_fkey" FOREIGN KEY ("schoolId", "academicSessionId") REFERENCES "AcademicSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PtmSection" ADD CONSTRAINT "PtmSection_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtmSection" ADD CONSTRAINT "PtmSection_schoolId_ptmId_fkey" FOREIGN KEY ("schoolId", "ptmId") REFERENCES "Ptm"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PtmSection" ADD CONSTRAINT "PtmSection_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PtmSlot" ADD CONSTRAINT "PtmSlot_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtmSlot" ADD CONSTRAINT "PtmSlot_schoolId_ptmId_fkey" FOREIGN KEY ("schoolId", "ptmId") REFERENCES "Ptm"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PtmSlot" ADD CONSTRAINT "PtmSlot_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PtmSlot" ADD CONSTRAINT "PtmSlot_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PtmSlot" ADD CONSTRAINT "PtmSlot_schoolId_parentId_fkey" FOREIGN KEY ("schoolId", "parentId") REFERENCES "Parent"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- A PTM window runs forward, and its slots fit inside it.
ALTER TABLE "Ptm" ADD CONSTRAINT "Ptm_window_check" CHECK ("endMinute" > "startMinute" AND "slotMinutes" BETWEEN 5 AND 120);
ALTER TABLE "PtmSlot" ADD CONSTRAINT "PtmSlot_window_check" CHECK ("endMinute" > "startMinute");
-- A booked slot names its child and parent; an open one names neither.
ALTER TABLE "PtmSlot" ADD CONSTRAINT "PtmSlot_booking_check" CHECK ((status = 'BOOKED') = ("studentId" IS NOT NULL AND "parentId" IS NOT NULL));
