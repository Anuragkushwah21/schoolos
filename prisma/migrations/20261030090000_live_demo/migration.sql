-- AlterTable
ALTER TABLE "School" ADD COLUMN     "demoExpiresAt" TIMESTAMP(3),
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "School_isDemo_demoExpiresAt_idx" ON "School"("isDemo", "demoExpiresAt");

