-- CreateEnum
CREATE TYPE "VisitorStatus" AS ENUM ('INSIDE', 'LEFT', 'DENIED');

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "personToMeet" TEXT NOT NULL,
    "vehicleNo" TEXT,
    "entryAt" TIMESTAMP(3) NOT NULL,
    "exitAt" TIMESTAMP(3),
    "status" "VisitorStatus" NOT NULL DEFAULT 'INSIDE',
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visitor_schoolId_entryAt_idx" ON "Visitor"("schoolId", "entryAt");

-- CreateIndex
CREATE INDEX "Visitor_schoolId_status_idx" ON "Visitor"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_schoolId_id_key" ON "Visitor"("schoolId", "id");

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

