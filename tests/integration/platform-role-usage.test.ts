/**
 * The Super Admin's "Roles in use": per school, which optional roles are
 * switched on and how many current people hold each — counts only, each
 * school counted on its own, Super Admin only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { assertWithinLimit } from "@/server/platform/entitlements";
import { roleUsage } from "@/server/platform/role-usage";
import { setSchoolRolesAndLimits } from "@/server/platform/schools";

import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "pru";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "R", lastName: "U" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "R", lastName: "U", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { enabledRoles: ["PRINCIPAL", "ACCOUNTANT", "RECEPTIONIST"], roleLimits: { ACCOUNTANT: 3 } } });
  await prisma.staffMember.createMany({
    data: [
      { schoolId: schoolA.schoolId, employeeId: `${PREFIX}1`, firstName: "Acc", lastName: "One", role: "ACCOUNTANT" },
      { schoolId: schoolA.schoolId, employeeId: `${PREFIX}2`, firstName: "Acc", lastName: "Two", role: "ACCOUNTANT", status: "ON_LEAVE" },
      // Left: not counted.
      { schoolId: schoolA.schoolId, employeeId: `${PREFIX}3`, firstName: "Acc", lastName: "Gone", role: "ACCOUNTANT", status: "RESIGNED" },
      // Kept from before: the role is no longer switched on.
      { schoolId: schoolA.schoolId, employeeId: `${PREFIX}4`, firstName: "Lib", lastName: "Kept", role: "LIBRARIAN" },
      { schoolId: schoolB.schoolId, employeeId: `${PREFIX}5`, firstName: "Drv", lastName: "B", role: "DRIVER" },
    ],
  });
  await prisma.user.create({ data: { email: `principal@${PREFIX}.test`, passwordHash: "x", role: "PRINCIPAL", firstName: "Pri", lastName: "Ncipal", schoolId: schoolA.schoolId } });
}, 60_000);

afterAll(async () => {
  await prisma.staffMember.deleteMany({ where: { employeeId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: `@${PREFIX}.test` } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("roles in use, for the Super Admin", () => {
  it("counts current people per role, says which roles are on, and keeps each school apart", async () => {
    const usage = await roleUsage(superAdmin, [schoolA.schoolId, schoolB.schoolId]);
    const a = usage.get(schoolA.schoolId)!;
    const row = (role: string) => a.roles.find((entry) => entry.role === role)!;
    expect(row("ACCOUNTANT")).toEqual({ role: "ACCOUNTANT", enabled: true, people: 2, limit: 3 });
    expect(row("PRINCIPAL")).toMatchObject({ enabled: true, people: 1 });
    expect(row("RECEPTIONIST")).toMatchObject({ enabled: true, people: 0 });
    expect(row("DRIVER")).toMatchObject({ enabled: false, people: 0 });
    expect(a.enabledCount).toBe(3);
    expect(a.inUse.map((entry) => entry.role).sort()).toEqual(["ACCOUNTANT", "LIBRARIAN", "PRINCIPAL"]);
    expect(a.outsideEnabled.map((entry) => entry.role)).toEqual(["LIBRARIAN"]);
    expect(a.core.schoolAdmins).toBeGreaterThanOrEqual(1);
    expect(a.core.teachers).toBeGreaterThanOrEqual(1);

    const b = usage.get(schoolB.schoolId)!;
    expect(b.roles.find((entry) => entry.role === "DRIVER")?.people).toBe(1);
    expect(b.roles.find((entry) => entry.role === "ACCOUNTANT")?.people).toBe(0);
  });

  it("the Super Admin sets a school's role limits; they are enforced, and a limit below today's people is flagged", async () => {
    await setSchoolRolesAndLimits(superAdmin, { schoolId: schoolA.schoolId, followPlan: false, roles: ["PRINCIPAL", "ACCOUNTANT", "RECEPTIONIST"], limits: { ACCOUNTANT: 1, RECEPTIONIST: 2 } });
    const a = (await roleUsage(superAdmin, [schoolA.schoolId])).get(schoolA.schoolId)!;
    expect(a.roles.find((row) => row.role === "ACCOUNTANT")).toMatchObject({ people: 2, limit: 1 });
    expect(a.roles.find((row) => row.role === "RECEPTIONIST")).toMatchObject({ people: 0, limit: 2 });
    expect(a.used).toMatchObject({ ACCOUNTANT: 2, STAFF: 3 });
    // Nobody more past the limit — for the School Admin too; within it, fine.
    await expect(assertWithinLimit({ schoolId: schoolA.schoolId }, "ACCOUNTANT")).rejects.toThrow(/allows up to 1 accountant/i);
    await expect(assertWithinLimit({ schoolId: schoolA.schoolId }, "RECEPTIONIST", 2)).resolves.toBeUndefined();
    await expect(assertWithinLimit({ schoolId: schoolA.schoolId }, "RECEPTIONIST", 3)).rejects.toThrow(/allows up to 2/);
    // Another school is untouched.
    expect((await roleUsage(superAdmin, [schoolB.schoolId])).get(schoolB.schoolId)!.roles.find((row) => row.role === "ACCOUNTANT")?.limit ?? null).not.toBe(1);
    // Only the Super Admin sets limits.
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: schoolA.adminUserId } });
    await expect(setSchoolRolesAndLimits({ ...superAdmin, id: admin.id, role: "SCHOOL_ADMIN", schoolId: schoolA.schoolId }, { schoolId: schoolA.schoolId, followPlan: false, roles: [], limits: { ACCOUNTANT: 99 } })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is the Super Admin's only", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: schoolA.adminUserId } });
    const asAdmin: SessionUser = { id: admin.id, email: admin.email, role: "SCHOOL_ADMIN", firstName: admin.firstName, lastName: admin.lastName, schoolId: schoolA.schoolId, schoolSlug: null, schoolName: null, schoolStatus: "ACTIVE" };
    await expect(roleUsage(asAdmin, [schoolA.schoolId])).rejects.toBeInstanceOf(ForbiddenError);
  });
});
