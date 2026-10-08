-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "optionalModules" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "modulesCustomized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optionalModules" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- Each plan starts with its tier's optional modules (editable on Features & Plans).
UPDATE "Plan" SET "optionalModules" = ARRAY['FINANCE']::TEXT[] WHERE "tier" = 'STARTER';
UPDATE "Plan" SET "optionalModules" = ARRAY['FINANCE','EXPENSES','PAYROLL','LIBRARY']::TEXT[] WHERE "tier" = 'STANDARD';
UPDATE "Plan" SET "optionalModules" = ARRAY['FINANCE','EXPENSES','PAYROLL','LIBRARY','TRANSPORT','INVENTORY']::TEXT[] WHERE "tier" = 'PRO';

-- Schools that exist today keep everything they use now: all optional
-- modules, marked as set for this school so a later plan change does not
-- silently take a module away. The Super Admin adjusts them per school.
UPDATE "School" SET "optionalModules" = ARRAY['FINANCE','EXPENSES','PAYROLL','LIBRARY','TRANSPORT','INVENTORY']::TEXT[], "modulesCustomized" = true;
