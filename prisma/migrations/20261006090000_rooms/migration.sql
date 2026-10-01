-- Rooms: a school's physical rooms, picked per timetable period.
--
-- Until now a period's room was free text. Each school's distinct room texts
-- (matched ignoring case and surrounding spaces) become Room records, and
-- every period is linked to its room. The text column stays as the label the
-- timetables print, normalised to the room's name.

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('CLASSROOM', 'LAB', 'COMPUTER_LAB', 'LIBRARY', 'HALL', 'STAFF_ROOM', 'SPORTS', 'ACTIVITY', 'OTHER');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "type" "RoomType" NOT NULL DEFAULT 'CLASSROOM',
    "capacity" INTEGER,
    "building" TEXT,
    "floor" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Room_schoolId_isActive_idx" ON "Room"("schoolId", "isActive");
CREATE UNIQUE INDEX "Room_schoolId_id_key" ON "Room"("schoolId", "id");
CREATE UNIQUE INDEX "Room_schoolId_nameKey_key" ON "Room"("schoolId", "nameKey");

ALTER TABLE "Room" ADD CONSTRAINT "Room_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "TimetableSlot" ADD COLUMN "roomId" TEXT;

-- Backfill: one room per school per distinct room text. The first spelling
-- (alphabetically) becomes the name; ids are derived so a re-run is stable.
INSERT INTO "Room" ("id", "schoolId", "name", "nameKey", "type", "isActive", "createdAt", "updatedAt")
SELECT
    'room_' || md5(t."schoolId" || ':' || t."nameKey"),
    t."schoolId",
    t."name",
    t."nameKey",
    'CLASSROOM',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT "schoolId", lower(btrim("room")) AS "nameKey", min(btrim("room")) AS "name"
    FROM "TimetableSlot"
    WHERE "room" IS NOT NULL AND btrim("room") <> ''
    GROUP BY "schoolId", lower(btrim("room"))
) t;

UPDATE "TimetableSlot" s
SET "roomId" = r."id", "room" = r."name"
FROM "Room" r
WHERE r."schoolId" = s."schoolId"
  AND s."room" IS NOT NULL
  AND r."nameKey" = lower(btrim(s."room"));

-- Blank room texts mean "no room".
UPDATE "TimetableSlot" SET "room" = NULL WHERE "room" IS NOT NULL AND btrim("room") = '';

CREATE INDEX "TimetableSlot_schoolId_academicSessionId_roomId_dayOfWeek_idx" ON "TimetableSlot"("schoolId", "academicSessionId", "roomId", "dayOfWeek");

ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_schoolId_roomId_fkey" FOREIGN KEY ("schoolId", "roomId") REFERENCES "Room"("schoolId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
