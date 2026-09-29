/**
 * The School Admin's "Needs attention" list shows only what someone must act
 * on, counts only their own school, and is for the admin alone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { today } from "@/lib/dates";
import { ForbiddenError } from "@/lib/errors";
import { needsAttention } from "@/server/analytics/today";
import { absentStudents, telHref } from "@/server/attendance/absentees";
import { prisma } from "@/server/db/prisma";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

const input = (school: SeededSchool, extra: Partial<Parameters<typeof needsAttention>[1]> = {}) => ({
  academicSessionId: school.academicSessionId,
  registersPending: 0,
  staffMarked: 1,
  closedToday: false,
  ...extra,
});

describe("needs attention", () => {
  it("is empty when nothing needs action", async () => {
    expect(await needsAttention(adminOf(schoolA), input(schoolA))).toEqual([]);
  });

  it("lists absences, pending leave and unmarked registers, each with where to act", async () => {
    await prisma.studentAttendance.create({
      data: {
        schoolId: schoolA.schoolId,
        academicSessionId: schoolA.academicSessionId,
        studentId: schoolA.studentIds[0]!,
        sectionId: schoolA.sectionId,
        date: today(),
        status: "ABSENT",
        markedByUserId: schoolA.adminUserId,
      },
    });
    await prisma.leaveRequest.create({
      data: { schoolId: schoolA.schoolId, teacherId: schoolA.teacherId, type: "CASUAL", startDate: today(), endDate: today(), reason: "Family" },
    });
    const items = await needsAttention(adminOf(schoolA), input(schoolA, { registersPending: 2, staffMarked: 0 }));
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey.absent).toMatchObject({ count: 1, href: "/school-admin/attendance/absent" });
    expect(byKey.leave).toMatchObject({ count: 1, href: "/school-admin/leave" });
    expect(byKey.registers).toMatchObject({ count: 2, href: "/school-admin/attendance" });
    expect(byKey["staff-register"]).toMatchObject({ href: "/school-admin/attendance/staff" });

    // A holiday owes no registers.
    const closed = await needsAttention(adminOf(schoolA), input(schoolA, { registersPending: 2, staffMarked: 0, closedToday: true }));
    expect(closed.map((item) => item.key)).not.toContain("registers");
    expect(closed.map((item) => item.key)).not.toContain("staff-register");
  });

  it("counts only its own school, for the admin only", async () => {
    expect(await needsAttention(adminOf(schoolB), input(schoolB))).toEqual([]);
    await expect(needsAttention(teacherOf(schoolA), input(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("opens into the absent students with their parents' numbers to call", async () => {
    const { rows, total } = await absentStudents(adminOf(schoolA), { date: today() });
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      studentId: schoolA.studentIds[0],
      admissionNumber: "ADM1",
      rollNumber: "1",
      absencesThisSession: 1,
    });
    expect(rows[0]!.guardians[0]).toMatchObject({ phone: "+91-90000-00001", isPrimary: true });
    expect(telHref(rows[0]!.guardians[0]!.phone)).toBe("tel:+919000000001");
    // Filtered to another class, nobody; another school or another role, nothing.
    expect((await absentStudents(adminOf(schoolA), { date: today(), sectionId: schoolA.unassignedSectionId })).total).toBe(0);
    expect((await absentStudents(adminOf(schoolB), { date: today() })).total).toBe(0);
    await expect(absentStudents(teacherOf(schoolA), { date: today() })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
