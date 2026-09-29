-- AlterTable
ALTER TABLE "School" ADD COLUMN     "udiseCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "School_udiseCode_key" ON "School"("udiseCode");

