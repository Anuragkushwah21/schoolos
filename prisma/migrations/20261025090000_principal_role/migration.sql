-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PRINCIPAL';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

