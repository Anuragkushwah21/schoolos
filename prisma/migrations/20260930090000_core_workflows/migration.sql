
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffPermission" ADD VALUE 'MANAGE_LIBRARY';
ALTER TYPE "StaffPermission" ADD VALUE 'COLLECT_FEES';

-- AlterTable
ALTER TABLE "FeePayment" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "staffMemberId" TEXT,
ALTER COLUMN "teacherId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "setupSkipped" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "alertsReadAt" TIMESTAMP(3),
ADD COLUMN     "readAlertKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "LeaveRequest_schoolId_staffMemberId_startDate_idx" ON "LeaveRequest"("schoolId", "staffMemberId", "startDate");

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_schoolId_staffMemberId_fkey" FOREIGN KEY ("schoolId", "staffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A leave request belongs to exactly one person: a teacher or a staff member.
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_one_applicant_check" CHECK (("teacherId" IS NULL) <> ("staffMemberId" IS NULL));
