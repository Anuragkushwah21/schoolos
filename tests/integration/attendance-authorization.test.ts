/**
 * Who may take a daily register.
 *
 *   * The class teacher of a section, in the current session — nobody else
 *     among teachers, however the request is edited.
 *   * A subject teacher still sees the section's students, but cannot take
 *     or overwrite its register.
 *   * Changing the class teacher moves the register with it; attendance
 *     already taken stays exactly as it was.
 *   * Last session's class does not carry over into a new session.
 *   * No school reaches another's registers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ForbiddenError } from "@/lib/errors";
import { addDays, today } from "@/lib/dates";
import { setClassTeacher } from "@/server/academics/structure";
import { getRegister, markAttendance } from "@/server/attendance/service";
import { attendanceSectionIds, canMarkAttendance } from "@/server/auth/teacher-access";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { getMyRoster } from "@/server/people/teacher-self";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let subjectOnly: { id: string; ctx: TenantContext };

async function addTeacher(school: SeededSchool, key: string) {
  const user = await prisma.user.create({
    data: { email: `${key}@iso-test-a.test`, passwordHash: "not-a-real-hash", role: "TEACHER", firstName: key, lastName: "Teacher", schoolId: school.schoolId },
  });
  const teacher = await prisma.teacher.create({
    data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Teacher" },
  });
  return { id: teacher.id, ctx: contextFor(school, user.id, "TEACHER") };
}

/** The most recent weekday, so the register is not a weekly off. */
function schoolDay(): Date {
  let day = today();
  while (day.getUTCDay() === 0) day = addDays(day, -1);
  return day;
}

const entries = (school: SeededSchool) => school.studentIds.map((studentId) => ({ studentId, status: "PRESENT" as const, remarks: null }));

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // Teaches Mathematics in section A, but is not its class teacher.
  subjectOnly = await addTeacher(schoolA, "maths");
  await prisma.teacherSubjectAssignment.create({
    data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, teacherId: subjectOnly.id, subjectId: schoolA.subjectId, sectionId: schoolA.sectionId },
  });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the class teacher", () => {
  it("sees only their own class in the selector and can take its register", async () => {
    expect(await attendanceSectionIds(teacherOf(schoolA), schoolA.academicSessionId)).toEqual([schoolA.sectionId]);
    const register = await getRegister(teacherOf(schoolA), schoolA.sectionId, schoolDay());
    expect(register.rows.map((row) => row.studentId).sort()).toEqual([...schoolA.studentIds].sort());
    const { saved } = await markAttendance(teacherOf(schoolA), { sectionId: schoolA.sectionId, date: schoolDay(), entries: entries(schoolA) });
    expect(saved).toBe(schoolA.studentIds.length);
  });

  it("cannot open or save another section by editing the request", async () => {
    const before = await prisma.studentAttendance.count({ where: { sectionId: schoolA.unassignedSectionId } });
    await expect(getRegister(teacherOf(schoolA), schoolA.unassignedSectionId, schoolDay())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      markAttendance(teacherOf(schoolA), { sectionId: schoolA.unassignedSectionId, date: schoolDay(), entries: entries(schoolA) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.studentAttendance.count({ where: { sectionId: schoolA.unassignedSectionId } })).toBe(before);
    // The refusal is on the audit trail.
    expect(await prisma.auditLog.count({ where: { schoolId: schoolA.schoolId, action: "ATTENDANCE_ACCESS_DENIED" } })).toBeGreaterThan(0);
  });

  it("cannot slip another school's section or students into a save", async () => {
    await expect(getRegister(teacherOf(schoolA), schoolB.sectionId, schoolDay())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      markAttendance(teacherOf(schoolA), { sectionId: schoolA.sectionId, date: schoolDay(), entries: entries(schoolB) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.studentAttendance.count({ where: { studentId: { in: schoolB.studentIds }, date: schoolDay() } })).toBe(0);
    await expect(getRegister(adminOf(schoolB), schoolA.sectionId, schoolDay())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps the date rules", async () => {
    await expect(
      markAttendance(teacherOf(schoolA), { sectionId: schoolA.sectionId, date: addDays(today(), 1), entries: entries(schoolA) }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      markAttendance(teacherOf(schoolA), { sectionId: schoolA.sectionId, date: addDays(today(), -30), entries: entries(schoolA) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a subject teacher", () => {
  it("sees the section's students but cannot take or overwrite its register", async () => {
    expect((await getMyRoster(subjectOnly.ctx, schoolA.sectionId)).students.length).toBe(schoolA.studentIds.length);
    expect(await attendanceSectionIds(subjectOnly.ctx, schoolA.academicSessionId)).toEqual([]);
    await expect(getRegister(subjectOnly.ctx, schoolA.sectionId, schoolDay())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      markAttendance(subjectOnly.ctx, { sectionId: schoolA.sectionId, date: schoolDay(), entries: entries(schoolA).map((e) => ({ ...e, status: "ABSENT" as const })) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.studentAttendance.count({ where: { sectionId: schoolA.sectionId, date: schoolDay(), status: "ABSENT" } })).toBe(0);
  });

  it("parents and students never take registers", async () => {
    expect(await canMarkAttendance(contextFor(schoolA, schoolA.parentUserId, "PARENT"), schoolA.sectionId)).toBe(false);
    expect(await canMarkAttendance(contextFor(schoolA, schoolA.studentUserId, "STUDENT"), schoolA.sectionId)).toBe(false);
  });
});

describe("changes of assignment", () => {
  it("moves the register with the class teacher and leaves past attendance alone", async () => {
    const taken = await prisma.studentAttendance.findMany({ where: { sectionId: schoolA.sectionId }, orderBy: { id: "asc" } });
    await setClassTeacher(adminOf(schoolA), { sectionId: schoolA.sectionId, teacherId: subjectOnly.id });

    expect(await canMarkAttendance(teacherOf(schoolA), schoolA.sectionId)).toBe(false);
    expect(await canMarkAttendance(subjectOnly.ctx, schoolA.sectionId)).toBe(true);
    expect(await prisma.studentAttendance.findMany({ where: { sectionId: schoolA.sectionId }, orderBy: { id: "asc" } })).toEqual(taken);

    await setClassTeacher(adminOf(schoolA), { sectionId: schoolA.sectionId, teacherId: schoolA.teacherId });
  });

  it("does not carry last session's class into a new one", async () => {
    const next = await prisma.academicSession.create({
      data: { schoolId: schoolA.schoolId, name: "2027-28", startDate: new Date(Date.UTC(2027, 3, 1)), endDate: new Date(Date.UTC(2028, 2, 31)) },
    });
    await prisma.academicSession.update({ where: { id: schoolA.academicSessionId }, data: { isCurrent: false } });
    await prisma.academicSession.update({ where: { id: next.id }, data: { isCurrent: true } });
    try {
      expect(await canMarkAttendance(teacherOf(schoolA), schoolA.sectionId)).toBe(false);
      await expect(getMyRoster(subjectOnly.ctx, schoolA.sectionId)).rejects.toBeInstanceOf(ForbiddenError);
      // The School Admin can still open and correct last session's register.
      expect(await canMarkAttendance(adminOf(schoolA), schoolA.sectionId)).toBe(true);
    } finally {
      await prisma.academicSession.update({ where: { id: next.id }, data: { isCurrent: false } });
      await prisma.academicSession.update({ where: { id: schoolA.academicSessionId }, data: { isCurrent: true } });
    }
  });
});
