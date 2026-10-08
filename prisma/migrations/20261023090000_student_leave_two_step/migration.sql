-- AlterEnum
ALTER TYPE "StudentLeaveStatus" ADD VALUE 'TEACHER_APPROVED';

-- AlterTable
ALTER TABLE "StudentLeave" ADD COLUMN     "teacherApproved" BOOLEAN,
ADD COLUMN     "teacherComment" TEXT,
ADD COLUMN     "teacherReviewedAt" TIMESTAMP(3),
ADD COLUMN     "teacherReviewedById" TEXT;

-- AddForeignKey
ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_teacherReviewedById_fkey" FOREIGN KEY ("teacherReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

