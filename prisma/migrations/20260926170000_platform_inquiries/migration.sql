-- CreateEnum
CREATE TYPE "InquiryTopic" AS ENUM ('DEMO', 'PRICING', 'ONBOARDING', 'SUPPORT', 'PARTNERSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- CreateTable
CREATE TABLE "PlatformInquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "topic" "InquiryTopic" NOT NULL DEFAULT 'DEMO',
    "message" TEXT NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "ipAddress" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformInquiry_status_createdAt_idx" ON "PlatformInquiry"("status", "createdAt");

