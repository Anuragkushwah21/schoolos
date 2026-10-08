/**
 * Create the missing non-teaching staff TEST logins for one school, without
 * touching anything that already exists.
 *
 *   npx tsx scripts/create-staff-test-accounts.ts                 # dry run: reads only, prints the plan
 *   npx tsx scripts/create-staff-test-accounts.ts --apply         # creates what the dry run listed
 *   ... --school "Green Valley Academy"                           # default school name
 *
 * For each role it skips when the school already has a current staff member
 * in that role with a working login, or when the test email is already used.
 * Otherwise it creates one active, already-activated NON_TEACHING_STAFF login
 * and its staff record with the role's default permissions. Existing users,
 * staff, students and settings are never updated or deleted.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma/client";
import type { StaffRole } from "../src/generated/prisma/enums";
import { STAFF_ROLE_DEFAULT_GRANTS, STAFF_ROLE_NAMES } from "../src/lib/staff-access";
import { connectionConfig } from "../src/server/db/connection";

const PASSWORD = "SchoolOS@2026";
const ACCOUNTS: Array<{ role: StaffRole; email: string; firstName: string; lastName: string; code: string }> = [
  { role: "LIBRARIAN", email: "librarian@schoolos.test", firstName: "Test", lastName: "Librarian", code: "TEST-LIB" },
  { role: "DRIVER", email: "driver@schoolos.test", firstName: "Test", lastName: "Driver", code: "TEST-DRV" },
  { role: "ACCOUNTANT", email: "accountant@schoolos.test", firstName: "Test", lastName: "Accountant", code: "TEST-ACC" },
  { role: "RECEPTIONIST", email: "receptionist@schoolos.test", firstName: "Test", lastName: "Receptionist", code: "TEST-REC" },
  { role: "LAB_ASSISTANT", email: "labassistant@schoolos.test", firstName: "Test", lastName: "Lab Assistant", code: "TEST-LAB" },
  { role: "SECURITY", email: "security@schoolos.test", firstName: "Test", lastName: "Security", code: "TEST-SEC" },
  { role: "PEON", email: "support@schoolos.test", firstName: "Test", lastName: "Support Staff", code: "TEST-SUP" },
];
/** The migration that added grants and role profiles; without it nothing here can be written. */
const REQUIRED_MIGRATION = "20261013090000_staff_roles_substitutes_trips";

const apply = process.argv.includes("--apply");
const schoolArg = process.argv.indexOf("--school");
const schoolName = schoolArg > -1 ? process.argv[schoolArg + 1]! : "Green Valley Academy";
const prisma = new PrismaClient({ adapter: new PrismaPg(connectionConfig(process.env.DATABASE_URL!)) });

type Row = { name: string; role: string; email: string; password: string; status: string };

async function main() {
  const applied = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`,
    REQUIRED_MIGRATION,
  );
  if (!applied.length) {
    throw new Error(`Migration ${REQUIRED_MIGRATION} is not applied to this database. Run "npx prisma migrate deploy" first; nothing was changed.`);
  }

  const schools = await prisma.school.findMany({ where: { name: schoolName }, select: { id: true, name: true, status: true } });
  if (schools.length !== 1) throw new Error(`Expected exactly one school named "${schoolName}", found ${schools.length}. Nothing was changed.`);
  const school = schools[0]!;

  const rows: Row[] = [];
  for (const account of ACCOUNTS) {
    const roleName = STAFF_ROLE_NAMES[account.role];
    const existing = await prisma.staffMember.findFirst({
      where: { schoolId: school.id, role: account.role, status: { in: ["ACTIVE", "ON_LEAVE"] }, user: { isActive: true } },
      select: { firstName: true, lastName: true, user: { select: { email: true } } },
    });
    if (existing) {
      rows.push({ name: `${existing.firstName} ${existing.lastName}`, role: roleName, email: existing.user?.email ?? "—", password: "(unchanged)", status: "Already exists — skipped" });
      continue;
    }
    if (await prisma.user.findUnique({ where: { email: account.email }, select: { id: true } })) {
      rows.push({ name: `${account.firstName} ${account.lastName}`, role: roleName, email: account.email, password: "(unchanged)", status: "Email already in use — skipped" });
      continue;
    }
    if (!apply) {
      rows.push({ name: `${account.firstName} ${account.lastName}`, role: roleName, email: account.email, password: PASSWORD, status: "Will be created (dry run)" });
      continue;
    }

    // A free employee ID: TEST-LIB, else TEST-LIB-2, …
    let employeeId = account.code;
    for (let n = 2; await prisma.staffMember.findFirst({ where: { schoolId: school.id, employeeId }, select: { id: true } }); n += 1) employeeId = `${account.code}-${n}`;

    await prisma.$transaction(async (tx) => {
      // The school's built-in role profile, as the app creates it on first use.
      const profile =
        (await tx.staffRoleProfile.findFirst({ where: { schoolId: school.id, baseRole: account.role, isCustom: false }, select: { id: true, defaultGrants: true } })) ??
        (await tx.staffRoleProfile.create({
          data: { schoolId: school.id, name: roleName, baseRole: account.role, defaultGrants: STAFF_ROLE_DEFAULT_GRANTS[account.role] },
          select: { id: true, defaultGrants: true },
        }));
      const user = await tx.user.create({
        data: {
          email: account.email,
          passwordHash: await bcrypt.hash(PASSWORD, 12),
          role: "NON_TEACHING_STAFF",
          firstName: account.firstName,
          lastName: account.lastName,
          schoolId: school.id,
          isActive: true,
          activatedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.staffMember.create({
        data: {
          schoolId: school.id,
          userId: user.id,
          employeeId,
          firstName: account.firstName,
          lastName: account.lastName,
          role: account.role,
          designation: `${roleName} (test account)`,
          email: account.email,
          status: "ACTIVE",
          roleProfileId: profile.id,
          grants: profile.defaultGrants,
          notes: "Test login for checking this role's screens. Safe to set Inactive when no longer needed.",
        },
      });
    });
    rows.push({ name: `${account.firstName} ${account.lastName}`, role: roleName, email: account.email, password: PASSWORD, status: "Created" });
  }

  console.log(`School: ${school.name} (${school.status})${apply ? "" : " — DRY RUN, nothing written"}\n`);
  console.log("| Name | Role | Email | Password | Status |\n| --- | --- | --- | --- | --- |");
  for (const row of rows) console.log(`| ${row.name} | ${row.role} | ${row.email} | ${row.password} | ${row.status} |`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
