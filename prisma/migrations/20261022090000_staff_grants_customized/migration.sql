-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "grantsCustomized" BOOLEAN NOT NULL DEFAULT false;


-- Staff whose permissions a School Admin already set by hand keep them: they never follow a role's updated defaults.
UPDATE "StaffMember" s SET "grantsCustomized" = true
WHERE EXISTS (
  SELECT 1 FROM "AuditLog" a
  WHERE a."entityType" = 'StaffMember' AND a."entityId" = s."id" AND a."actorId" IS NOT NULL
    AND a."action" IN ('STAFF_PERMISSIONS_CHANGED', 'STAFF_PERMISSION_ADDED', 'STAFF_PERMISSION_REMOVED')
);
