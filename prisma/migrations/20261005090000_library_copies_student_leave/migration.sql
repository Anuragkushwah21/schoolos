-- Physical book copies (BK-0001…), library loan settings, and student leave requests.
-- Existing books get one copy per unit of quantity; open loans each take a copy.


-- CreateEnum
CREATE TYPE "BookCopyStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "StudentLeaveReason" AS ENUM ('SICK', 'FAMILY_FUNCTION', 'MEDICAL_APPOINTMENT', 'PERSONAL', 'TRAVEL', 'OTHER');

-- CreateEnum
CREATE TYPE "StudentLeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "BookIssue" ADD COLUMN     "copyId" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "lastBookCopyNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "libraryLoanDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "libraryMaxLoans" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "studentLeaveBackdateDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "BookCopy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "BookCopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentLeave" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "reason" "StudentLeaveReason" NOT NULL,
    "reasonText" TEXT,
    "note" TEXT,
    "status" "StudentLeaveStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "requestedByRole" "UserRole" NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookCopy_schoolId_bookId_status_idx" ON "BookCopy"("schoolId", "bookId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BookCopy_schoolId_id_key" ON "BookCopy"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BookCopy_schoolId_code_key" ON "BookCopy"("schoolId", "code");

-- CreateIndex
CREATE INDEX "StudentLeave_schoolId_status_fromDate_idx" ON "StudentLeave"("schoolId", "status", "fromDate");

-- CreateIndex
CREATE INDEX "StudentLeave_schoolId_studentId_fromDate_idx" ON "StudentLeave"("schoolId", "studentId", "fromDate");

-- CreateIndex
CREATE INDEX "StudentLeave_schoolId_sectionId_status_idx" ON "StudentLeave"("schoolId", "sectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudentLeave_schoolId_id_key" ON "StudentLeave"("schoolId", "id");

-- CreateIndex
CREATE INDEX "BookIssue_schoolId_copyId_idx" ON "BookIssue"("schoolId", "copyId");

-- AddForeignKey
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_schoolId_copyId_fkey" FOREIGN KEY ("schoolId", "copyId") REFERENCES "BookCopy"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BookCopy" ADD CONSTRAINT "BookCopy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookCopy" ADD CONSTRAINT "BookCopy_schoolId_bookId_fkey" FOREIGN KEY ("schoolId", "bookId") REFERENCES "Book"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_schoolId_sectionId_fkey" FOREIGN KEY ("schoolId", "sectionId") REFERENCES "Section"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Backfill: copies for existing books, numbered per school in the order the
-- books were added.
-- -----------------------------------------------------------------------------
WITH units AS (
  SELECT b."schoolId", b."id" AS book_id,
         ROW_NUMBER() OVER (PARTITION BY b."schoolId" ORDER BY b."createdAt", b."id", g.n) AS seq
  FROM "Book" b
  CROSS JOIN LATERAL generate_series(1, GREATEST(b."quantity", 0)) AS g(n)
)
INSERT INTO "BookCopy" ("id", "schoolId", "bookId", "code", "status", "updatedAt")
SELECT gen_random_uuid()::text, "schoolId", book_id, 'BK-' || LPAD(seq::text, 4, '0'), 'AVAILABLE', CURRENT_TIMESTAMP
FROM units;

UPDATE "School" s SET "lastBookCopyNumber" = c.n
FROM (SELECT "schoolId", COUNT(*) AS n FROM "BookCopy" GROUP BY "schoolId") c
WHERE s."id" = c."schoolId";

-- Each open loan takes one copy of its book, oldest loan first.
WITH loans AS (
  SELECT "id", "bookId", ROW_NUMBER() OVER (PARTITION BY "bookId" ORDER BY "issuedOn", "createdAt", "id") AS rn
  FROM "BookIssue" WHERE "returnedOn" IS NULL
),
copies AS (
  SELECT "id", "bookId", ROW_NUMBER() OVER (PARTITION BY "bookId" ORDER BY "createdAt", "code") AS rn
  FROM "BookCopy"
)
UPDATE "BookIssue" i SET "copyId" = c."id"
FROM loans l JOIN copies c ON c."bookId" = l."bookId" AND c.rn = l.rn
WHERE i."id" = l."id";

UPDATE "BookCopy" c SET "status" = 'ISSUED'
WHERE EXISTS (SELECT 1 FROM "BookIssue" i WHERE i."copyId" = c."id" AND i."returnedOn" IS NULL);
