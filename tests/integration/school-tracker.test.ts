/**
 * The Super Admin's school list: counts, fee revenue and owner details per
 * school, and the UDISE code that identifies it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "@/lib/errors";
import { today } from "@/lib/dates";
import { registerSchoolSchema, udiseSchema } from "@/lib/validation/platform";
import { schoolTracker } from "@/server/analytics/platform";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { recordPayment } from "@/server/finance/fees";
import { setSchoolUdise } from "@/server/platform/schools";

import { adminOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;

const asRole = (role: SessionUser["role"]): SessionUser => ({ ...superAdmin, role });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const user = await prisma.user.create({
    data: {
      email: "super@tracker-test.test",
      passwordHash: "x",
      role: "SUPER_ADMIN",
      firstName: "Platform",
      lastName: "Owner",
    },
  });
  superAdmin = {
    id: user.id,
    email: user.email,
    role: "SUPER_ADMIN",
    firstName: "Platform",
    lastName: "Owner",
    schoolId: null,
    schoolSlug: null,
    schoolName: null,
    schoolStatus: null,
  };

  await prisma.school.update({
    where: { id: schoolA.schoolId },
    data: { city: "Indore", state: "Madhya Pradesh", establishedYear: 1998, principalName: "Dr. Rao" },
  });
  await recordPayment(adminOf(schoolA), {
    studentId: schoolA.studentIds[0]!,
    amountMinor: 12_500_00,
    paidOn: today(),
    method: "UPI",
    receiptNo: "TRK-1",
    notes: null,
  });
}, 60_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: "super@tracker-test.test" } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the school list", () => {
  it("shows each school's counts, fee revenue, location and owner", async () => {
    const { rows } = await schoolTracker(superAdmin, { q: "Isolation Test School" });
    const a = rows.find((row) => row.id === schoolA.schoolId)!;
    const b = rows.find((row) => row.id === schoolB.schoolId)!;

    const studentsA = await prisma.student.count({ where: { schoolId: schoolA.schoolId, status: "ACTIVE" } });
    expect(a).toMatchObject({
      students: studentsA,
      teachers: 1,
      revenueMinor: 12_500_00,
      establishedYear: 1998,
      location: "Indore, Madhya Pradesh",
    });
    expect(a.owner).toMatchObject({ name: "Fixture Contact", principal: "Dr. Rao" });
    expect(a.owner.email).toContain("iso-test-a");
    expect(a.owner.admins.map((admin) => admin.email)).toContain("admin@iso-test-a.test");

    // School B's money is its own.
    expect(b.revenueMinor).toBe(0);
  });

  it("searches by city", async () => {
    const { rows } = await schoolTracker(superAdmin, { q: "indore" });
    expect(rows.map((row) => row.id)).toContain(schoolA.schoolId);
    expect(rows.map((row) => row.id)).not.toContain(schoolB.schoolId);
  });

  it("is Super Admin only", async () => {
    for (const role of ["SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT"] as const) {
      await expect(schoolTracker(asRole(role))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setSchoolUdise(asRole(role), schoolA.schoolId, "12345678901")).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});

describe("UDISE codes", () => {
  it("sets, searches and clears a code", async () => {
    await setSchoolUdise(superAdmin, schoolA.schoolId, "23260100101");
    const { rows } = await schoolTracker(superAdmin, { q: "23260100101" });
    expect(rows.map((row) => row.id)).toEqual([schoolA.schoolId]);

    await setSchoolUdise(superAdmin, schoolA.schoolId, null);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).udiseCode).toBeNull();
  });

  it("refuses a code another school already has", async () => {
    await setSchoolUdise(superAdmin, schoolA.schoolId, "11111111111");
    await expect(setSchoolUdise(superAdmin, schoolB.schoolId, "11111111111")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("accepts 11 digits, spaces removed, and nothing else", () => {
    expect(udiseSchema.parse({ schoolId: "s", udiseCode: "2326 0100 101" }).udiseCode).toBe("23260100101");
    expect(udiseSchema.parse({ schoolId: "s", udiseCode: "" }).udiseCode).toBeNull();
    expect(udiseSchema.safeParse({ schoolId: "s", udiseCode: "12345" }).success).toBe(false);
    expect(udiseSchema.safeParse({ schoolId: "s", udiseCode: "ABCDEFGHIJK" }).success).toBe(false);
    expect(registerSchoolSchema.shape).toHaveProperty("udiseCode");
  });
});
