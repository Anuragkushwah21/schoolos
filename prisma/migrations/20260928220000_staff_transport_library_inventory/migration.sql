-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ACCOUNTANT', 'RECEPTIONIST', 'LIBRARIAN', 'DRIVER', 'TRANSPORT_ATTENDANT', 'PEON', 'OFFICE_STAFF', 'COORDINATOR', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BUS', 'VAN', 'CAR', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TransportStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('COMPUTER', 'FURNITURE', 'PROJECTOR', 'LAB_EQUIPMENT', 'SPORTS', 'STATIONERY', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'IN_REPAIR', 'DAMAGED', 'LOST', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "libraryFinePerDayMinor" INTEGER NOT NULL DEFAULT 200;

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "designation" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "joiningDate" DATE,
    "status" "TeacherStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRoute" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "attendantId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "pickupMinute" INTEGER,
    "dropMinute" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentTransport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stopId" TEXT,
    "status" "TransportStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentTransport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "isbn" TEXT,
    "category" TEXT,
    "publisher" TEXT,
    "shelf" TEXT,
    "quantity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookIssue" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "staffMemberId" TEXT,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "returnedOn" DATE,
    "fineMinor" INTEGER NOT NULL DEFAULT 0,
    "finePaid" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "purchaseDate" DATE,
    "purchaseCostMinor" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "location" TEXT,
    "assignedTo" TEXT,
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "fromStatus" "AssetStatus",
    "toStatus" "AssetStatus",
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffMember_schoolId_role_status_idx" ON "StaffMember"("schoolId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_schoolId_id_key" ON "StaffMember"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_schoolId_employeeId_key" ON "StaffMember"("schoolId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_schoolId_id_key" ON "Vehicle"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_schoolId_registrationNo_key" ON "Vehicle"("schoolId", "registrationNo");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRoute_schoolId_id_key" ON "TransportRoute"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRoute_schoolId_name_key" ON "TransportRoute"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_schoolId_id_key" ON "RouteStop"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_schoolId_routeId_sequence_key" ON "RouteStop"("schoolId", "routeId", "sequence");

-- CreateIndex
CREATE INDEX "StudentTransport_schoolId_routeId_idx" ON "StudentTransport"("schoolId", "routeId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentTransport_schoolId_id_key" ON "StudentTransport"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StudentTransport_schoolId_studentId_key" ON "StudentTransport"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "Book_schoolId_title_idx" ON "Book"("schoolId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "Book_schoolId_id_key" ON "Book"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Book_schoolId_isbn_key" ON "Book"("schoolId", "isbn");

-- CreateIndex
CREATE INDEX "BookIssue_schoolId_bookId_returnedOn_idx" ON "BookIssue"("schoolId", "bookId", "returnedOn");

-- CreateIndex
CREATE INDEX "BookIssue_schoolId_dueOn_returnedOn_idx" ON "BookIssue"("schoolId", "dueOn", "returnedOn");

-- CreateIndex
CREATE INDEX "BookIssue_schoolId_studentId_idx" ON "BookIssue"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BookIssue_schoolId_id_key" ON "BookIssue"("schoolId", "id");

-- CreateIndex
CREATE INDEX "Asset_schoolId_category_status_idx" ON "Asset"("schoolId", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_schoolId_id_key" ON "Asset"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_schoolId_code_key" ON "Asset"("schoolId", "code");

-- CreateIndex
CREATE INDEX "AssetEvent_schoolId_assetId_createdAt_idx" ON "AssetEvent"("schoolId", "assetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetEvent_schoolId_id_key" ON "AssetEvent"("schoolId", "id");

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_schoolId_vehicleId_fkey" FOREIGN KEY ("schoolId", "vehicleId") REFERENCES "Vehicle"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_schoolId_driverId_fkey" FOREIGN KEY ("schoolId", "driverId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_schoolId_attendantId_fkey" FOREIGN KEY ("schoolId", "attendantId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_schoolId_routeId_fkey" FOREIGN KEY ("schoolId", "routeId") REFERENCES "TransportRoute"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentTransport" ADD CONSTRAINT "StudentTransport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTransport" ADD CONSTRAINT "StudentTransport_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentTransport" ADD CONSTRAINT "StudentTransport_schoolId_routeId_fkey" FOREIGN KEY ("schoolId", "routeId") REFERENCES "TransportRoute"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentTransport" ADD CONSTRAINT "StudentTransport_schoolId_stopId_fkey" FOREIGN KEY ("schoolId", "stopId") REFERENCES "RouteStop"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_schoolId_bookId_fkey" FOREIGN KEY ("schoolId", "bookId") REFERENCES "Book"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_schoolId_teacherId_fkey" FOREIGN KEY ("schoolId", "teacherId") REFERENCES "Teacher"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_schoolId_staffMemberId_fkey" FOREIGN KEY ("schoolId", "staffMemberId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_schoolId_assetId_fkey" FOREIGN KEY ("schoolId", "assetId") REFERENCES "Asset"("schoolId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Counts are never negative; a vehicle and a batch of assets hold something.
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_capacity_check" CHECK ("capacity" > 0);
ALTER TABLE "Book" ADD CONSTRAINT "Book_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_fine_check" CHECK ("fineMinor" >= 0);
-- A loan is due on or after the day it was made, and returned on or after it too.
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_dates_check" CHECK ("dueOn" >= "issuedOn" AND ("returnedOn" IS NULL OR "returnedOn" >= "issuedOn"));
-- Exactly one borrower per loan.
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_one_borrower_check" CHECK (num_nonnulls("studentId", "teacherId", "staffMemberId") = 1);
