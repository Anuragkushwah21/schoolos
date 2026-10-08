-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('NOTICE', 'ANNOUNCEMENT', 'EMERGENCY');

-- AlterEnum
ALTER TYPE "NoticeScope" ADD VALUE 'STREAM';

-- AlterTable
ALTER TABLE "Notice" ADD COLUMN     "kind" "NoticeKind" NOT NULL DEFAULT 'NOTICE',
ADD COLUMN     "streamId" TEXT;

-- CreateIndex
CREATE INDEX "Notice_schoolId_kind_status_idx" ON "Notice"("schoolId", "kind", "status");

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_schoolId_streamId_fkey" FOREIGN KEY ("schoolId", "streamId") REFERENCES "Stream"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

