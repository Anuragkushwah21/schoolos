-- Non-teaching staff: role profiles, module × action grants, date-range
-- substitutions with temporary access, and drivers' pickup/drop records.
-- Additive only: StaffMember.permissions is kept (no longer read) and its
-- meaning is copied into the new grants column below.


-- CreateEnum
CREATE TYPE "TransportTrip" AS ENUM ('PICKUP', 'DROP');

-- CreateEnum
CREATE TYPE "TransportTripStatus" AS ENUM ('PICKED_UP', 'NOT_PRESENT', 'DROPPED', 'ISSUE');

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "grants" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "roleProfileId" TEXT;

-- CreateTable
CREATE TABLE "StaffRoleProfile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseRole" "StaffRole" NOT NULL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "defaultGrants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRoleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSubstitution" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "originalStaffId" TEXT NOT NULL,
    "substituteStaffId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "grants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverRoutes" BOOLEAN NOT NULL DEFAULT true,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffSubstitution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTripLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "routeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "stopId" TEXT,
    "trip" "TransportTrip" NOT NULL,
    "status" "TransportTripStatus" NOT NULL,
    "note" TEXT,
    "markedById" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportTripLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportIssue" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "reportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffRoleProfile_schoolId_id_key" ON "StaffRoleProfile"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRoleProfile_schoolId_name_key" ON "StaffRoleProfile"("schoolId", "name");

-- CreateIndex
CREATE INDEX "StaffSubstitution_schoolId_substituteStaffId_startDate_idx" ON "StaffSubstitution"("schoolId", "substituteStaffId", "startDate");

-- CreateIndex
CREATE INDEX "StaffSubstitution_schoolId_originalStaffId_startDate_idx" ON "StaffSubstitution"("schoolId", "originalStaffId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSubstitution_schoolId_id_key" ON "StaffSubstitution"("schoolId", "id");

-- CreateIndex
CREATE INDEX "TransportTripLog_schoolId_routeId_date_idx" ON "TransportTripLog"("schoolId", "routeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TransportTripLog_schoolId_id_key" ON "TransportTripLog"("schoolId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TransportTripLog_schoolId_date_studentId_trip_key" ON "TransportTripLog"("schoolId", "date", "studentId", "trip");

-- CreateIndex
CREATE INDEX "TransportIssue_schoolId_routeId_date_idx" ON "TransportIssue"("schoolId", "routeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TransportIssue_schoolId_id_key" ON "TransportIssue"("schoolId", "id");

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_schoolId_roleProfileId_fkey" FOREIGN KEY ("schoolId", "roleProfileId") REFERENCES "StaffRoleProfile"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffRoleProfile" ADD CONSTRAINT "StaffRoleProfile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSubstitution" ADD CONSTRAINT "StaffSubstitution_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSubstitution" ADD CONSTRAINT "StaffSubstitution_schoolId_originalStaffId_fkey" FOREIGN KEY ("schoolId", "originalStaffId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffSubstitution" ADD CONSTRAINT "StaffSubstitution_schoolId_substituteStaffId_fkey" FOREIGN KEY ("schoolId", "substituteStaffId") REFERENCES "StaffMember"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StaffSubstitution" ADD CONSTRAINT "StaffSubstitution_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSubstitution" ADD CONSTRAINT "StaffSubstitution_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripLog" ADD CONSTRAINT "TransportTripLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripLog" ADD CONSTRAINT "TransportTripLog_schoolId_routeId_fkey" FOREIGN KEY ("schoolId", "routeId") REFERENCES "TransportRoute"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TransportTripLog" ADD CONSTRAINT "TransportTripLog_schoolId_studentId_fkey" FOREIGN KEY ("schoolId", "studentId") REFERENCES "Student"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TransportTripLog" ADD CONSTRAINT "TransportTripLog_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportIssue" ADD CONSTRAINT "TransportIssue_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportIssue" ADD CONSTRAINT "TransportIssue_schoolId_routeId_fkey" FOREIGN KEY ("schoolId", "routeId") REFERENCES "TransportRoute"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TransportIssue" ADD CONSTRAINT "TransportIssue_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Carry every staff member's access over to grants, meaning for meaning.
-- What a designation used to bring by itself is carried too, so nobody loses
-- access: a Librarian ran the library; a driver or attendant saw their route.
-- A Librarian never holds students, transport or finance grants.
UPDATE "StaffMember" AS m
SET "grants" = ARRAY(
  SELECT DISTINCT g FROM unnest(
    (CASE WHEN 'VIEW_STUDENTS' = ANY (m."permissions"::text[]) THEN ARRAY['students.directory', 'students.contact'] ELSE ARRAY[]::text[] END)
    || (CASE WHEN 'VIEW_LIBRARY' = ANY (m."permissions"::text[]) THEN ARRAY['library.view'] ELSE ARRAY[]::text[] END)
    || (CASE WHEN 'MANAGE_LIBRARY' = ANY (m."permissions"::text[]) OR m."role" = 'LIBRARIAN'
          THEN ARRAY['library.view', 'library.circulation', 'library.books.create', 'library.books.edit', 'library.copies', 'library.fines'] ELSE ARRAY[]::text[] END)
    || (CASE WHEN 'VIEW_TRANSPORT' = ANY (m."permissions"::text[]) THEN ARRAY['transport.routes'] ELSE ARRAY[]::text[] END)
    || (CASE WHEN 'COLLECT_FEES' = ANY (m."permissions"::text[]) THEN ARRAY['fees.view', 'fees.collect'] ELSE ARRAY[]::text[] END)
    || (CASE WHEN m."role" IN ('DRIVER', 'TRANSPORT_ATTENDANT') THEN ARRAY['transport.myroute', 'transport.riders', 'transport.trips'] ELSE ARRAY[]::text[] END)
  ) AS g
  WHERE NOT (m."role" = 'LIBRARIAN' AND (g LIKE 'students.%' OR g LIKE 'transport.%' OR g LIKE 'fees.%'))
    AND NOT (m."role" IN ('DRIVER', 'TRANSPORT_ATTENDANT') AND g LIKE 'students.%')
  ORDER BY g
);
