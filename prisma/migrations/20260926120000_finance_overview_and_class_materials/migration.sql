-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('ELECTRICITY', 'RENT', 'STATIONERY', 'MAINTENANCE', 'TRANSPORT', 'EVENTS', 'EQUIPMENT', 'INTERNET', 'OTHER');

-- AlterEnum
ALTER TYPE "LessonMaterialKind" ADD VALUE 'VIDEO';

-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "classSessionId" TEXT;

-- AlterTable
ALTER TABLE "LessonMaterial" ADD COLUMN     "description" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "storageKey" TEXT;

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "spentOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "forMonth" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_schoolId_spentOn_idx" ON "Expense"("schoolId", "spentOn");

-- CreateIndex
CREATE INDEX "Expense_schoolId_category_spentOn_idx" ON "Expense"("schoolId", "category", "spentOn");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_schoolId_id_key" ON "Expense"("schoolId", "id");

-- CreateIndex
CREATE INDEX "SalaryPayment_schoolId_paidOn_idx" ON "SalaryPayment"("schoolId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_schoolId_id_key" ON "SalaryPayment"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_schoolId_teacherId_forMonth_key" ON "SalaryPayment"("schoolId", "teacherId", "forMonth");

-- CreateIndex
CREATE UNIQUE INDEX "Homework_schoolId_classSessionId_key" ON "Homework"("schoolId", "classSessionId");

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_schoolId_classSessionId_fkey" FOREIGN KEY ("schoolId", "classSessionId") REFERENCES "ClassSession"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

