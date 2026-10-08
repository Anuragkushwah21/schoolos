-- AlterTable
ALTER TABLE "SalaryPayment" ADD COLUMN     "staffMemberId" TEXT,
ALTER COLUMN "teacherId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TeacherSalary" ADD COLUMN     "staffMemberId" TEXT,
ALTER COLUMN "teacherId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_schoolId_staffMemberId_forMonth_key" ON "SalaryPayment"("schoolId", "staffMemberId", "forMonth");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherSalary_schoolId_staffMemberId_effectiveFrom_key" ON "TeacherSalary"("schoolId", "staffMemberId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "TeacherSalary" ADD CONSTRAINT "TeacherSalary_schoolId_staffMemberId_fkey" FOREIGN KEY ("schoolId", "staffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_schoolId_staffMemberId_fkey" FOREIGN KEY ("schoolId", "staffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Each salary row and each payment belongs to exactly one person: a teacher or a staff member.
ALTER TABLE "TeacherSalary" ADD CONSTRAINT "TeacherSalary_one_payee" CHECK (("teacherId" IS NULL) <> ("staffMemberId" IS NULL));
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_one_payee" CHECK (("teacherId" IS NULL) <> ("staffMemberId" IS NULL));
