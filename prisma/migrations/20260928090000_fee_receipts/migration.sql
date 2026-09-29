-- AlterTable
ALTER TABLE "FeePayment" ADD COLUMN     "referenceNo" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "receiptFooterNote" TEXT,
ADD COLUMN     "receiptHeaderNote" TEXT,
ADD COLUMN     "showFeesToStudents" BOOLEAN NOT NULL DEFAULT false;

