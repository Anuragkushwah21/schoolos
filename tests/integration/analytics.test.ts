/**
 * The numbers behind the dashboards.
 *
 * A chart is only as honest as its query, so these check the aggregates
 * themselves: that they stay inside the school, that a teacher's charts cover
 * only the teacher's own sections, and that a day with no register is a gap
 * rather than a zero.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { prisma } from "@/server/db/prisma";
import { markAttendance } from "@/server/attendance/service";
import {
  attendanceTrend,
  classStrength,
  genderSplit,
  registersOutstanding,
  studentsNeedingAttention,
} from "@/server/analytics/school";
import { attendanceSpark, monthlyAttendance } from "@/server/analytics/student";

import { adminOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());

  // Two days of attendance in school A: everyone present yesterday, and one
  // student absent the day before.
  const ctx = adminOf(schoolA);
  await markAttendance(ctx, {
    sectionId: schoolA.sectionId,
    date: addDays(today(), -1),
    entries: schoolA.studentIds.map((studentId) => ({ studentId, status: "PRESENT", remarks: null })),
  });
  await markAttendance(ctx, {
    sectionId: schoolA.sectionId,
    date: addDays(today(), -2),
    entries: schoolA.studentIds.map((studentId, index) => ({
      studentId,
      status: index === 0 ? ("ABSENT" as const) : ("PRESENT" as const),
      remarks: null,
    })),
  });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("attendance trend", () => {
  it("summarises only the caller's school", async () => {
    const a = await attendanceTrend(adminOf(schoolA), {
      academicSessionId: schoolA.academicSessionId,
      days: 7,
    });
    const b = await attendanceTrend(adminOf(schoolB), {
      academicSessionId: schoolB.academicSessionId,
      days: 7,
    });

    const totalA = a.reduce((sum, point) => sum + point.counts.total, 0);
    const totalB = b.reduce((sum, point) => sum + point.counts.total, 0);

    // Two days marked here for A's students, and B sees only its own fixture day.
    expect(totalA).toBe(schoolA.studentIds.length * 2);
    expect(totalB).toBe(schoolB.studentIds.length);
  });

  it("leaves unmarked days as gaps rather than zeroes, and drops Sundays", async () => {
    const points = await attendanceTrend(adminOf(schoolA), {
      academicSessionId: schoolA.academicSessionId,
      days: 7,
    });

    const unmarked = points.find((point) => point.counts.total === 0);
    expect(unmarked?.share).toBeNull();

    expect(points.every((point) => point.date.getUTCDay() !== 0)).toBe(true);
  });

  it("counts late as attended and absent as not", async () => {
    const points = await attendanceTrend(adminOf(schoolA), {
      academicSessionId: schoolA.academicSessionId,
      days: 7,
    });

    const yesterday = points.find((point) => point.key === toDateInput(addDays(today(), -1)));
    const before = points.find((point) => point.key === toDateInput(addDays(today(), -2)));

    expect(yesterday?.share).toBe(1);
    expect(before?.share).toBeCloseTo(
      (schoolA.studentIds.length - 1) / schoolA.studentIds.length,
      5,
    );
  });

  it("narrows to the sections a teacher actually teaches", async () => {
    const mine = await attendanceTrend(adminOf(schoolA), {
      academicSessionId: schoolA.academicSessionId,
      days: 7,
      sectionIds: [schoolA.unassignedSectionId],
    });
    expect(mine.every((point) => point.counts.total === 0)).toBe(true);
  });
});

describe("school aggregates", () => {
  it("counts students per class within the school only", async () => {
    const rows = await classStrength(adminOf(schoolA), schoolA.academicSessionId);
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    expect(total).toBe(schoolA.studentIds.length);
  });

  it("splits gender within the school only", async () => {
    const split = await genderSplit(adminOf(schoolA));
    expect(split.total).toBe(schoolA.studentIds.length);
    expect(split.boys + split.girls + split.other).toBe(split.total);
  });

  it("lists which registers are outstanding today", async () => {
    const rows = await registersOutstanding(adminOf(schoolA), schoolA.academicSessionId);
    expect(rows.length).toBeGreaterThan(0);
    // Nothing was marked for today in this fixture.
    expect(rows.every((row) => row.marked === false)).toBe(true);
  });

  it("ignores students with too few marked days to judge", async () => {
    // One absence out of two days is 50%, but two days is not a record.
    const rows = await studentsNeedingAttention(adminOf(schoolA), {
      academicSessionId: schoolA.academicSessionId,
      threshold: 0.75,
    });
    expect(rows).toHaveLength(0);
  });
});

describe("one student's own shape", () => {
  const rows = [
    { date: new Date(Date.UTC(2026, 7, 10)), status: "PRESENT" as const },
    { date: new Date(Date.UTC(2026, 7, 11)), status: "ABSENT" as const },
    { date: new Date(Date.UTC(2026, 8, 1)), status: "LATE" as const },
  ];

  it("buckets by calendar month, oldest first", () => {
    const months = monthlyAttendance(rows);
    expect(months.map((month) => month.label)).toEqual(["Aug", "Sept"]);
    expect(months[0]?.share).toBe(0.5);
    // Late still counts as attended.
    expect(months[1]?.share).toBe(1);
  });

  it("turns the recent days into a 1/0 sparkline, oldest first", () => {
    expect(attendanceSpark(rows)).toEqual([1, 0, 1]);
  });
});
