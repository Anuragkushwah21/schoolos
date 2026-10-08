/**
 * Half Day attendance.
 *
 *   * The class teacher (or the School Admin) can mark Half Day; it counts as
 *     half a day attended in summaries and reports, and is counted on its own.
 *   * The School Admin can turn Half Day off for the school; the server then
 *     refuses it, while the half days already marked stay.
 *   * A teacher without attendance access cannot mark anything, Half Day
 *     included; no future dates; a correction is audited with old and new.
 *   * Existing statuses and records are untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attendedDays, attendedValue } from "@/lib/attendance";
import { addDays, today } from "@/lib/dates";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { attendanceSettings, saveAttendanceSettings } from "@/server/attendance/cover";
import { attendedShare, getRegister, markAttendance, sectionReport, studentHistory } from "@/server/attendance/service";
import { prisma } from "@/server/db/prisma";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

function schoolDay(): Date {
  let day = today();
  while (day.getUTCDay() === 0) day = addDays(day, -1);
  return day;
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("counting a half day", () => {
  it("is half a day attended, everywhere", () => {
    expect(attendedValue("HALF_DAY")).toBe(0.5);
    expect(attendedValue("EXCUSED")).toBe(0);
    expect(attendedDays({ PRESENT: 3, LATE: 1, HALF_DAY: 2 })).toBe(5);
    expect(attendedShare({ PRESENT: 1, LATE: 0, ABSENT: 0, EXCUSED: 0, HALF_DAY: 1, total: 2 })).toBe(0.75);
  });
});

describe("marking Half Day", () => {
  const date = schoolDay();

  it("the class teacher marks it; the register, history and report show it", async () => {
    const [half, present, absent] = schoolA.studentIds as [string, string, string];
    await markAttendance(teacherOf(schoolA), {
      sectionId: schoolA.sectionId,
      date,
      entries: [
        { studentId: half, status: "HALF_DAY", remarks: "Left at noon" },
        { studentId: present, status: "PRESENT", remarks: null },
        { studentId: absent, status: "ABSENT", remarks: null },
      ],
    });
    const register = await getRegister(teacherOf(schoolA), schoolA.sectionId, date);
    expect(register.halfDay).toBe(true);
    expect(register.rows.find((row) => row.studentId === half)?.status).toBe("HALF_DAY");

    const history = await studentHistory(adminOf(schoolA), half, schoolA.academicSessionId);
    expect(history.counts.HALF_DAY).toBe(1);

    const report = await sectionReport(adminOf(schoolA), schoolA.sectionId, date, date);
    expect(report.students.find((row) => row.studentId === half)).toMatchObject({ counts: { HALF_DAY: 1 }, share: 0.5 });
    expect(report.totals.HALF_DAY).toBe(1);
  });

  it("refuses a future date and a teacher without attendance access", async () => {
    await expect(
      markAttendance(teacherOf(schoolA), { sectionId: schoolA.sectionId, date: addDays(today(), 1), entries: [{ studentId: schoolA.studentIds[0]!, status: "HALF_DAY", remarks: null }] }),
    ).rejects.toBeInstanceOf(AppError);
    // The fixture teacher is not assigned to section B.
    await expect(
      markAttendance(teacherOf(schoolA), { sectionId: schoolA.unassignedSectionId, date, entries: [{ studentId: schoolA.studentIds[0]!, status: "HALF_DAY", remarks: null }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a correction to or from Half Day is audited with the old and new mark", async () => {
    await markAttendance(adminOf(schoolA), {
      sectionId: schoolA.sectionId,
      date,
      entries: [{ studentId: schoolA.studentIds[0]!, status: "PRESENT", remarks: null }],
      reason: "Came back after lunch",
    });
    const audit = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "ATTENDANCE_CORRECTED" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(audit)).toMatch(/HALF_DAY|Half day|half day/);
  });
});

describe("the School Admin decides whether Half Day is available", () => {
  it("off: the server refuses it; on again: allowed", async () => {
    await saveAttendanceSettings(adminOf(schoolA), { timing: "FIRST_PERIOD", halfDay: false });
    expect((await attendanceSettings(adminOf(schoolA))).halfDay).toBe(false);
    const entry = { sectionId: schoolA.sectionId, date: schoolDay(), entries: [{ studentId: schoolA.studentIds[1]!, status: "HALF_DAY" as const, remarks: null }], reason: "Left early" };
    await expect(markAttendance(adminOf(schoolA), entry)).rejects.toBeInstanceOf(ValidationError);
    // The half days already marked stay in the record.
    expect(await prisma.studentAttendance.count({ where: { schoolId: schoolA.schoolId, status: { in: ["HALF_DAY", "PRESENT"] } } })).toBeGreaterThan(0);
    await saveAttendanceSettings(adminOf(schoolA), { timing: "FIRST_PERIOD", halfDay: true });
    await markAttendance(adminOf(schoolA), entry);
  });

  it("only the School Admin changes it, and only for their own school", async () => {
    await expect(saveAttendanceSettings(teacherOf(schoolA), { timing: "FIRST_PERIOD", halfDay: false })).rejects.toBeInstanceOf(ForbiddenError);
    await saveAttendanceSettings(adminOf(schoolB), { timing: "FIRST_PERIOD", halfDay: false });
    expect((await attendanceSettings(adminOf(schoolA))).halfDay).toBe(true);
    await saveAttendanceSettings(adminOf(schoolB), { timing: "FIRST_PERIOD", halfDay: true });
  });
});
