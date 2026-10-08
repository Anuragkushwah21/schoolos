-- CreateEnum
CREATE TYPE "ResponsibilityStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResponsibilityPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "Responsibility" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "ResponsibilityStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "ResponsibilityPriority" NOT NULL DEFAULT 'NORMAL',
    "notes" TEXT,
    "progressNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Responsibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Responsibility_schoolId_status_idx" ON "Responsibility"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Responsibility_schoolId_assignedToId_idx" ON "Responsibility"("schoolId", "assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "Responsibility_schoolId_id_key" ON "Responsibility"("schoolId", "id");

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

