-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SERVICE_CERTIFICATE';

-- AlterTable
ALTER TABLE "IssuedDocument" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "principalProfileId" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "tcApprovalRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PrincipalProfile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "designation" TEXT NOT NULL DEFAULT 'Principal',
    "qualification" TEXT,
    "experience" TEXT,
    "appointmentDate" DATE,
    "joiningDate" DATE,
    "exitDate" DATE,
    "dateOfBirth" DATE,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrincipalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrincipalProfile_schoolId_id_key" ON "PrincipalProfile"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrincipalProfile_userId_key" ON "PrincipalProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PrincipalProfile_schoolId_employeeId_key" ON "PrincipalProfile"("schoolId", "employeeId");

-- CreateIndex
CREATE INDEX "IssuedDocument_schoolId_principalProfileId_idx" ON "IssuedDocument"("schoolId", "principalProfileId");

-- AddForeignKey
ALTER TABLE "IssuedDocument" ADD CONSTRAINT "IssuedDocument_schoolId_principalProfileId_fkey" FOREIGN KEY ("schoolId", "principalProfileId") REFERENCES "PrincipalProfile"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PrincipalProfile" ADD CONSTRAINT "PrincipalProfile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrincipalProfile" ADD CONSTRAINT "PrincipalProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

