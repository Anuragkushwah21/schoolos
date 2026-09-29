/**
 * Teacher leave and substitute cover.
 *
 *   * Leave dates follow business rules on the server: no inverted ranges, no
 *     more than 30 days back, no overlap with the teacher's own leave.
 *   * Only the School Admin decides, and a rejection needs a reason.
 *   * Approval writes ON_LEAVE for the working days already reached — never
 *     over a PRESENT mark — and pre-fills the staff register for later days.
 *   * Cover is refused when the substitute is teaching, already covering, or
 *     away themselves; the covering teacher sees the period in their day.
 *   * Nothing crosses schools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, dayOfWeek, today, toDateInput } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { leaveRequestSchema } from "@/lib/validation/leave";
import { getStaffRegister } from "@/server/attendance/service";
import type { TenantContext } from "@/server/auth/current-user";
import { getMyDayPlan } from "@/server/classwork/activities";
import { assignSubstitute, getCoverPlan } from "@/server/classwork/substitutes";
import { prisma } from "@/server/db/prisma";
import { applyForLeave, cancelLeave, decideLeave, getLeaveRequest, listLeaveRequests, listMyLeave } from "@/server/staff/leave";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let second: { id: string; ctx: TenantContext };
let third: { id: string; ctx: TenantContext };

async function addTeacher(school: SeededSchool, key: string) {
  const user = await prisma.user.create({
    data: {
      email: `${key}@iso-test-a.test`,
      passwordHash: "not-a-real-hash",
      role: "TEACHER",
      firstName: key,
      lastName: "Teacher",
      schoolId: school.schoolId,
    },
  });
  const teacher = await prisma.teacher.create({
    data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Teacher" },
  });
  return { id: teacher.id, ctx: contextFor(school, user.id, "TEACHER") };
}

/** The next day from `from` that is a school day (not Sunday). */
function nextSchoolDay(from: Date): Date {
  let date = from;
  while (dayOfWeek(date) === "SUNDAY") date = addDays(date, 1);
  return date;
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  second = await addTeacher(schoolA, "second");
  third = await addTeacher(schoolA, "third");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

const leave = (start: Date, end: Date) =>
  leaveRequestSchema.parse({ type: "SICK", startDate: toDateInput(start), endDate: toDateInput(end), reason: "Fever" });

describe("requesting leave", () => {
  it("refuses an inverted range, too far back, too long, or overlapping", async () => {
    expect(leaveRequestSchema.safeParse({ type: "SICK", startDate: "2026-10-10", endDate: "2026-10-01", reason: "x" }).success).toBe(false);
    await expect(applyForLeave(teacherOf(schoolA), leave(addDays(today(), -40), addDays(today(), -39)))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(applyForLeave(teacherOf(schoolA), leave(addDays(today(), 1), addDays(today(), 70)))).rejects.toBeInstanceOf(
      ValidationError,
    );

    await applyForLeave(teacherOf(schoolA), leave(addDays(today(), 20), addDays(today(), 22)));
    await expect(applyForLeave(teacherOf(schoolA), leave(addDays(today(), 22), addDays(today(), 24)))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("is for teachers only, and each teacher sees only their own", async () => {
    await expect(applyForLeave(adminOf(schoolA), leave(today(), today()))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listMyLeave(second.ctx)).toEqual([]);
    const [mine] = await listMyLeave(teacherOf(schoolA));
    await expect(cancelLeave(second.ctx, mine!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelLeave(teacherOf(schoolB), mine!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deciding leave", () => {
  it("is School Admin only, school-scoped, and needs a reason to reject", async () => {
    const [mine] = await listMyLeave(teacherOf(schoolA));
    await expect(decideLeave(teacherOf(schoolA), { leaveIds: [mine!.id], decision: "APPROVED", note: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(decideLeave(adminOf(schoolB), { leaveIds: [mine!.id], decision: "APPROVED", note: null })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getLeaveRequest(adminOf(schoolB), mine!.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listLeaveRequests(adminOf(schoolB))).toEqual([]);
    await expect(decideLeave(adminOf(schoolA), { leaveIds: [mine!.id], decision: "REJECTED", note: null })).rejects.toBeInstanceOf(
      ValidationError,
    );

    await decideLeave(adminOf(schoolA), { leaveIds: [mine!.id], decision: "REJECTED", note: "Exams that week" });
    await expect(decideLeave(adminOf(schoolA), { leaveIds: [mine!.id], decision: "APPROVED", note: null })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("writes ON_LEAVE for days already reached, keeping a PRESENT mark, and pre-fills the register ahead", async () => {
    const start = addDays(today(), -3);
    const end = addDays(today(), 2);
    // The office saw the teacher two days ago.
    await prisma.teacherAttendance.create({
      data: { schoolId: schoolA.schoolId, teacherId: schoolA.teacherId, date: addDays(today(), -2), status: "PRESENT" },
    });
    const { id } = await applyForLeave(teacherOf(schoolA), leave(start, end));
    await decideLeave(adminOf(schoolA), { leaveIds: [id], decision: "APPROVED", note: null });

    const marks = await prisma.teacherAttendance.findMany({
      where: { teacherId: schoolA.teacherId, date: { gte: start, lte: today() } },
      select: { date: true, status: true },
    });
    const byDay = new Map(marks.map((mark) => [toDateInput(mark.date), mark.status]));
    expect(byDay.get(toDateInput(addDays(today(), -2)))).toBe("PRESENT");
    for (let date = start; date <= today(); date = addDays(date, 1)) {
      if (dayOfWeek(date) === "SUNDAY" || toDateInput(date) === toDateInput(addDays(today(), -2))) continue;
      expect(byDay.get(toDateInput(date))).toBe("ON_LEAVE");
    }
    // Nothing is written for days not yet reached.
    expect(await prisma.teacherAttendance.count({ where: { teacherId: schoolA.teacherId, date: { gt: today() } } })).toBe(0);

    const tomorrow = nextSchoolDay(addDays(today(), 1));
    if (tomorrow <= end) {
      const register = await getStaffRegister(adminOf(schoolA), tomorrow);
      expect(register.find((row) => row.teacherId === schoolA.teacherId)?.onApprovedLeave).toBe(true);
    }

    // Started leave can no longer be cancelled by the teacher.
    await expect(cancelLeave(teacherOf(schoolA), id)).rejects.toBeInstanceOf(AppError);
  });
});

describe("arranging cover", () => {
  let day: Date;
  let absentSlot: string;
  let secondSlot: string;

  beforeAll(async () => {
    day = nextSchoolDay(addDays(today(), 7));
    const weekday = dayOfWeek(day);
    const make = (teacherId: string, sectionId: string, start: number, end: number) =>
      prisma.timetableSlot.create({
        data: {
          schoolId: schoolA.schoolId,
          academicSessionId: schoolA.academicSessionId,
          sectionId,
          subjectId: schoolA.subjectId,
          teacherId,
          dayOfWeek: weekday,
          startMinute: start,
          endMinute: end,
        },
      });
    absentSlot = (await make(schoolA.teacherId, schoolA.sectionId, 540, 585)).id; // 9:00–9:45
    secondSlot = (await make(second.id, schoolA.unassignedSectionId, 570, 615)).id; // 9:30–10:15

    // The fixture teacher is on approved leave that day.
    const { id } = await applyForLeave(teacherOf(schoolA), leave(day, day));
    await decideLeave(adminOf(schoolA), { leaveIds: [id], decision: "APPROVED", note: null });
  });

  it("lists the absent teacher's periods and only teachers free at that time", async () => {
    const plan = await getCoverPlan(adminOf(schoolA), day);
    const absentee = plan.absentees.find((row) => row.teacherId === schoolA.teacherId);
    const period = absentee?.periods.find((row) => row.slotId === absentSlot);
    const candidates = period?.candidates.map((row) => row.id) ?? [];
    expect(candidates).toContain(third.id);
    expect(candidates).not.toContain(second.id); // teaching 9:30–10:15 themselves
  });

  it("refuses a substitute who is teaching, already covering, or away", async () => {
    await expect(
      assignSubstitute(adminOf(schoolA), { timetableSlotId: absentSlot, date: day, teacherId: second.id }),
    ).rejects.toThrow(/already teaches/);

    await assignSubstitute(adminOf(schoolA), { timetableSlotId: absentSlot, date: day, teacherId: third.id });

    // Now the second teacher is away too; the third cannot cover both at once.
    const { id } = await applyForLeave(second.ctx, leave(day, day));
    await decideLeave(adminOf(schoolA), { leaveIds: [id], decision: "APPROVED", note: null });
    await expect(
      assignSubstitute(adminOf(schoolA), { timetableSlotId: secondSlot, date: day, teacherId: third.id }),
    ).rejects.toThrow(/already covering/);
    // And someone on leave cannot stand in.
    await expect(
      assignSubstitute(adminOf(schoolA), { timetableSlotId: secondSlot, date: day, teacherId: schoolA.teacherId }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("puts the cover in both teachers' day, and stays inside the school", async () => {
    const covering = await getMyDayPlan(third.ctx, day);
    expect(covering.periods.find((row) => row.slotId === absentSlot)?.coveringFor).toBe("Fixture Teacher");
    const own = await getMyDayPlan(teacherOf(schoolA), day);
    expect(own.periods.find((row) => row.slotId === absentSlot)?.coveredBy).toBe("third Teacher");

    await expect(
      assignSubstitute(adminOf(schoolB), { timetableSlotId: absentSlot, date: day, teacherId: third.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await getCoverPlan(adminOf(schoolB), day)).absentees).toEqual([]);
    await expect(getCoverPlan(teacherOf(schoolA), day)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
