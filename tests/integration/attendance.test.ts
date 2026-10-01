/**
 * Attendance marking: who may mark which register, for which days, and that a
 * forged submission cannot touch students outside the register.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ForbiddenError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { getRegister, markAttendance, sectionReport } from "@/server/attendance/service";

import { adminOf, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("marking attendance", () => {
  it("lets a teacher mark their own section today and records who marked it", async () => {
    const ctx = teacherOf(schoolA);
    const date = today();
    const entries = schoolA.studentIds.map((studentId, i) => ({
      studentId,
      status: i === 0 ? ("ABSENT" as const) : ("PRESENT" as const),
      remarks: i === 0 ? "Fever" : null,
    }));

    await markAttendance(ctx, { sectionId: schoolA.sectionId, date, entries });

    const register = await getRegister(ctx, schoolA.sectionId, date);
    expect(register.rows.map((row) => row.status)).toContain("ABSENT");
    expect(register.marked).toBe(schoolA.studentIds.length);

    const row = await prisma.studentAttendance.findFirstOrThrow({
      where: { studentId: schoolA.studentIds[0], date },
    });
    expect(row.markedByUserId).toBe(schoolA.teacherUserId);
    expect(row.remarks).toBe("Fever");
  });

  it("updates rather than duplicates when the register is saved again", async () => {
    const date = today();
    await markAttendance(teacherOf(schoolA), {
      sectionId: schoolA.sectionId,
      date,
      entries: [{ studentId: schoolA.studentIds[0]!, status: "LATE", remarks: null }],
      // A second save on a submitted register is a correction, which needs a reason.
      reason: "Arrived after the bell",
    });
    const rows = await prisma.studentAttendance.findMany({ where: { studentId: schoolA.studentIds[0], date } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("LATE");
  });

  it("refuses a section the teacher is not assigned to", async () => {
    await expect(
      markAttendance(teacherOf(schoolA), {
        sectionId: schoolA.unassignedSectionId,
        date: today(),
        entries: [{ studentId: schoolA.studentIds[0]!, status: "PRESENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a student from another school smuggled into the register", async () => {
    await expect(
      markAttendance(adminOf(schoolA), {
        sectionId: schoolA.sectionId,
        date: today(),
        entries: [{ studentId: schoolB.studentIds[0]!, status: "ABSENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const bRow = await prisma.studentAttendance.findFirst({
      where: { studentId: schoolB.studentIds[0], date: today() },
    });
    expect(bRow).toBeNull();
  });

  it("refuses another school's section outright", async () => {
    await expect(getRegister(adminOf(schoolA), schoolB.sectionId, today())).rejects.toThrow();
  });

  it("refuses future dates for everyone", async () => {
    await expect(
      markAttendance(adminOf(schoolA), {
        sectionId: schoolA.sectionId,
        date: addDays(today(), 1),
        entries: [{ studentId: schoolA.studentIds[0]!, status: "PRESENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("limits teachers to the last week but lets the admin correct older days", async () => {
    const old = addDays(today(), -10);
    const entries = [{ studentId: schoolA.studentIds[1]!, status: "EXCUSED" as const, remarks: null }];

    await expect(
      markAttendance(teacherOf(schoolA), { sectionId: schoolA.sectionId, date: old, entries }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await markAttendance(adminOf(schoolA), { sectionId: schoolA.sectionId, date: old, entries });
    const register = await getRegister(teacherOf(schoolA), schoolA.sectionId, old);
    expect(register.editable).toBe(false);
  });
});

describe("reports", () => {
  it("totals a student's marks over a date range", async () => {
    const report = await sectionReport(adminOf(schoolA), schoolA.sectionId, addDays(today(), -30), today());
    const first = report.students.find((s) => s.studentId === schoolA.studentIds[0]);
    // Fixture PRESENT on 18 Sep, plus LATE today.
    expect(first?.counts.total).toBeGreaterThanOrEqual(2);
    expect(first?.share).not.toBeNull();
  });
});
