-- Route number and start/end points, a stop's landmark, and a publish switch
-- for the public admission form. Additive only; existing admission forms stay
-- published, so nothing changes for a school until it unpublishes.

-- AlterTable
ALTER TABLE "AdmissionPortal" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "RouteStop" ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "TransportRoute" ADD COLUMN     "code" TEXT,
ADD COLUMN     "endPoint" TEXT,
ADD COLUMN     "startPoint" TEXT;
