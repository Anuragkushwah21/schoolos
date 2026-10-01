-- Notice read state: one row per person per notice they have opened or marked read.
-- Additive only: no existing data changes; every existing notice starts unread.

-- CreateTable
CREATE TABLE "NoticeRead" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoticeRead_schoolId_userId_idx" ON "NoticeRead"("schoolId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeRead_schoolId_id_key" ON "NoticeRead"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeRead_schoolId_noticeId_userId_key" ON "NoticeRead"("schoolId", "noticeId", "userId");

-- AddForeignKey
ALTER TABLE "NoticeRead" ADD CONSTRAINT "NoticeRead_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRead" ADD CONSTRAINT "NoticeRead_schoolId_noticeId_fkey" FOREIGN KEY ("schoolId", "noticeId") REFERENCES "Notice"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NoticeRead" ADD CONSTRAINT "NoticeRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

