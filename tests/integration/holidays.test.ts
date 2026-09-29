/**
 * School holidays and weekly offs: who may change them, who may read them,
 * that they stay inside their school, and how they shape attendance — a
 * holiday refuses a register and can never count as an absence.
 *
 * Also covers the context-aware date rules added alongside: attendance and
 * dates of birth are history (no future), events and notice expiries are
 * schedules (no new past dates).
 */
import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as holidaysRoute from "@/app/api/v1/holidays/route";
import * as attendanceRoute from "@/app/api/v1/attendance/route";
import { closureOn, holidayKeys, workingDays } from "@/lib/calendar";
import { addDays, dateOnly, dayOfWeek, isAllowedScheduleDate, today, toDateInput } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { holidaySchema, weeklyOffsSchema } from "@/lib/validation/calendar";
import { eventSchema } from "@/lib/validation/communication";
import { createStudentSchema } from "@/lib/validation/school";
import { getRegister, markAttendance, markStaffAttendance, studentHistory } from "@/server/attendance/service";
import {
  deleteHoliday,
  getWeeklyOffDays,
  listHolidays,
  saveHoliday,
  schoolClosureOn,
  setWeeklyOffDays,
  upcomingHolidays,
} from "@/server/calendar/holidays";
import { saveEvent } from "@/server/communication/events";
import { prisma } from "@/server/db/prisma";

import { callApi, apiRequest } from "../helpers/api";
import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");
const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");

/** A holiday input as the form would deliver it after parsing. */
const holiday = (overrides: Partial<Parameters<typeof saveHoliday>[1]> = {}) => ({
  holidayId: null,
  title: "Diwali Holiday",
  description: null,
  startDate: addDays(today(), 40),
  endDate: addDays(today(), 45),
  clearAttendance: false,
  ...overrides,
});

async function tokenFor(userId: string, schoolId: string) {
  const raw = `sos_${randomBytes(32).toString("base64url")}`;
  await prisma.apiToken.create({
    data: {
      name: "holiday test",
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      prefix: raw.slice(0, 8),
      scope: "FULL",
      userId,
      schoolId,
    },
  });
  return raw;
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("calendar rules", () => {
  const calendar = {
    weeklyOffDays: ["SUNDAY"] as const,
    holidays: [{ id: "h", title: "Diwali", startDate: dateOnly(2026, 11, 10), endDate: dateOnly(2026, 11, 15) }],
  };

  it("names why a day is closed, and treats both ends of a holiday as inclusive", () => {
    expect(closureOn(calendar, dateOnly(2026, 11, 10))?.kind).toBe("HOLIDAY");
    expect(closureOn(calendar, dateOnly(2026, 11, 15))?.kind).toBe("HOLIDAY");
    expect(closureOn(calendar, dateOnly(2026, 11, 16))).toBeNull();
    expect(closureOn(calendar, dateOnly(2026, 11, 22))?.kind).toBe("WEEKLY_OFF");
  });

  it("leaves holidays and weekly offs out of working days", () => {
    // 9–22 Nov 2026: 14 days, two Sundays (15 and 22), six holiday days (10–15, one a Sunday).
    const days = workingDays(calendar, dateOnly(2026, 11, 9), dateOnly(2026, 11, 22));
    expect(days.map(toDateInput)).toEqual([
      "2026-11-09",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ]);
    expect(holidayKeys(calendar, dateOnly(2026, 11, 1), dateOnly(2026, 11, 12)).size).toBe(3);
  });
});

describe("holiday validation", () => {
  const form = (fields: Record<string, string>) => holidaySchema.safeParse({ title: "Diwali", ...fields });

  it("makes a blank end date a one-day holiday", () => {
    const parsed = form({ startDate: "2026-11-10", endDate: "" });
    expect(parsed.success && toDateInput(parsed.data.endDate)).toBe("2026-11-10");
  });

  it("refuses an end date before the start date", () => {
    const parsed = form({ startDate: "2026-11-15", endDate: "2026-11-10" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["endDate"]);
  });

  it("refuses a closed week with no working day", () => {
    const all = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    expect(weeklyOffsSchema.safeParse({ weeklyOffDays: all }).success).toBe(false);
    expect(weeklyOffsSchema.safeParse({}).data?.weeklyOffDays).toEqual([]);
    expect(weeklyOffsSchema.safeParse({ weeklyOffDays: "SUNDAY" }).data?.weeklyOffDays).toEqual(["SUNDAY"]);
  });
});

describe("managing holidays", () => {
  let diwaliId: string;

  it("lets a School Admin declare, edit and list a multi-day holiday", async () => {
    diwaliId = await saveHoliday(adminOf(schoolA), holiday());
    await saveHoliday(adminOf(schoolA), holiday({ holidayId: diwaliId, description: "Festival of lights" }));

    const [row] = await listHolidays(adminOf(schoolA));
    expect(row).toMatchObject({ id: diwaliId, title: "Diwali Holiday", description: "Festival of lights" });

    const audit = await prisma.auditLog.findMany({ where: { entityId: diwaliId }, select: { action: true } });
    expect(audit.map((entry) => entry.action).sort()).toEqual(["HOLIDAY_CREATED", "HOLIDAY_UPDATED"]);
  });

  it("refuses a holiday that overlaps another", async () => {
    await expect(
      saveHoliday(adminOf(schoolA), holiday({ title: "Bhai Dooj", startDate: addDays(today(), 45), endDate: addDays(today(), 46) })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("shows the holiday read-only to teachers, students and parents of the same school", async () => {
    for (const ctx of [teacherOf(schoolA), studentOf(schoolA), parentOf(schoolA)]) {
      expect((await upcomingHolidays(ctx)).map((h) => h.id)).toContain(diwaliId);
      await expect(saveHoliday(ctx, holiday({ title: "Mine" }))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteHoliday(ctx, diwaliId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setWeeklyOffDays(ctx, { weeklyOffDays: [] })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("keeps each school's holidays to itself", async () => {
    expect(await listHolidays(adminOf(schoolB))).toEqual([]);
    expect(await listHolidays(teacherOf(schoolB))).toEqual([]);
    await expect(saveHoliday(adminOf(schoolB), holiday({ holidayId: diwaliId, title: "Hijacked" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteHoliday(adminOf(schoolB), diwaliId)).rejects.toBeInstanceOf(NotFoundError);
    // School B's own holiday on the same dates does not collide with A's.
    const own = await saveHoliday(adminOf(schoolB), holiday());
    await deleteHoliday(adminOf(schoolB), own);
  });

  it("serves the list to every role over the API, and refuses writes from a teacher", async () => {
    const teacher = await tokenFor(schoolA.teacherUserId, schoolA.schoolId);
    const parent = await tokenFor(schoolA.parentUserId, schoolA.schoolId);

    const listed = await callApi(holidaysRoute.GET, apiRequest("/api/v1/holidays", { token: parent }));
    expect(listed.status).toBe(200);
    expect((listed.body.data as Array<{ id: string }>).map((h) => h.id)).toContain(diwaliId);

    const write = await callApi(
      holidaysRoute.POST,
      apiRequest("/api/v1/holidays", { method: "POST", token: teacher, body: { title: "Nope", startDate: "2026-12-25" } }),
    );
    expect(write.status).toBe(403);
  });

  it("refuses an inverted range over the API", async () => {
    const admin = await tokenFor(schoolA.adminUserId, schoolA.schoolId);
    const result = await callApi(
      holidaysRoute.POST,
      apiRequest("/api/v1/holidays", {
        method: "POST",
        token: admin,
        body: { title: "Backwards", startDate: "2026-12-31", endDate: "2026-12-25" },
      }),
    );
    expect(result.status).toBe(422);
    expect(result.body.error?.fieldErrors?.endDate).toBeDefined();
  });

  it("lets the admin delete a holiday", async () => {
    await deleteHoliday(adminOf(schoolA), diwaliId);
    expect(await listHolidays(adminOf(schoolA))).toEqual([]);
  });
});

describe("holidays are today or later", () => {
  it("refuses a new holiday starting in the past, through the service and the API", async () => {
    await expect(
      saveHoliday(adminOf(schoolA), holiday({ startDate: addDays(today(), -1), endDate: addDays(today(), 2) })),
    ).rejects.toBeInstanceOf(ValidationError);

    const admin = await tokenFor(schoolA.adminUserId, schoolA.schoolId);
    const result = await callApi(
      holidaysRoute.POST,
      apiRequest("/api/v1/holidays", {
        method: "POST",
        token: admin,
        body: { title: "Yesterday", startDate: toDateInput(addDays(today(), -1)) },
      }),
    );
    expect(result.status).toBe(422);
    expect(result.body.error?.fieldErrors?.startDate).toBeDefined();
    expect(await listHolidays(adminOf(schoolA))).toEqual([]);
  });

  it("will not move an upcoming holiday into the past", async () => {
    const id = await saveHoliday(adminOf(schoolA), holiday());
    await expect(
      saveHoliday(adminOf(schoolA), holiday({ holidayId: id, startDate: addDays(today(), -3), endDate: addDays(today(), 2) })),
    ).rejects.toBeInstanceOf(ValidationError);
    await deleteHoliday(adminOf(schoolA), id);
  });

  it("lets a running holiday be extended without moving its start", async () => {
    const [row] = await prisma.holiday.createManyAndReturn({
      data: [{ schoolId: schoolA.schoolId, title: "Running", startDate: addDays(today(), -2), endDate: today() }],
    });
    await saveHoliday(
      adminOf(schoolA),
      holiday({ holidayId: row!.id, title: "Running", startDate: addDays(today(), -2), endDate: addDays(today(), 3) }),
    );
    expect(toDateInput((await prisma.holiday.findUniqueOrThrow({ where: { id: row!.id } })).endDate)).toBe(
      toDateInput(addDays(today(), 3)),
    );
    await prisma.holiday.deleteMany({ where: { id: row!.id } });
  });

  it("locks a holiday that has fully ended", async () => {
    const [row] = await prisma.holiday.createManyAndReturn({
      data: [{ schoolId: schoolA.schoolId, title: "Last week", startDate: addDays(today(), -9), endDate: addDays(today(), -7) }],
    });
    await expect(
      saveHoliday(adminOf(schoolA), holiday({ holidayId: row!.id, title: "Renamed", startDate: addDays(today(), 5), endDate: addDays(today(), 6) })),
    ).rejects.toBeInstanceOf(AppError);
    await expect(deleteHoliday(adminOf(schoolA), row!.id)).rejects.toBeInstanceOf(AppError);
    expect((await prisma.holiday.findUniqueOrThrow({ where: { id: row!.id } })).title).toBe("Last week");
    await prisma.holiday.deleteMany({ where: { id: row!.id } });
  });
});

describe("holidays and attendance", () => {
  it("refuses a register on a holiday, through the service and the API", async () => {
    // Holidays start today at the earliest, so today is the day under test.
    const day = today();
    const id = await saveHoliday(adminOf(schoolA), holiday({ title: "Rain closure", startDate: day, endDate: day }));

    const register = await getRegister(teacherOf(schoolA), schoolA.sectionId, day);
    expect(register.editable).toBe(false);
    expect(register.closure?.kind).toBe("HOLIDAY");

    await expect(
      markAttendance(teacherOf(schoolA), {
        sectionId: schoolA.sectionId,
        date: day,
        entries: [{ studentId: schoolA.studentIds[0]!, status: "ABSENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      markStaffAttendance(adminOf(schoolA), {
        date: day,
        entries: [{ teacherId: schoolA.teacherId, status: "ABSENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(AppError);

    const token = await tokenFor(schoolA.teacherUserId, schoolA.schoolId);
    const api = await callApi(
      attendanceRoute.POST,
      apiRequest("/api/v1/attendance", {
        method: "POST",
        token,
        body: {
          sectionId: schoolA.sectionId,
          date: toDateInput(day),
          entries: [{ studentId: schoolA.studentIds[0], status: "ABSENT" }],
        },
      }),
    );
    expect(api.status).toBe(422);
    expect(await prisma.studentAttendance.count({ where: { sectionId: schoolA.sectionId, date: day } })).toBe(0);

    await deleteHoliday(adminOf(schoolA), id);
  });

  it("still refuses a future date, even with the API", async () => {
    const token = await tokenFor(schoolA.adminUserId, schoolA.schoolId);
    const api = await callApi(
      attendanceRoute.POST,
      apiRequest("/api/v1/attendance", {
        method: "POST",
        token,
        body: {
          sectionId: schoolA.sectionId,
          date: toDateInput(addDays(today(), 1)),
          entries: [{ studentId: schoolA.studentIds[0], status: "PRESENT" }],
        },
      }),
    );
    expect(api.status).toBe(422);
  });

  it("does not require, but still accepts, attendance on a weekly off", async () => {
    let sunday = today();
    while (dayOfWeek(sunday) !== "SUNDAY") sunday = addDays(sunday, -1);

    const register = await getRegister(adminOf(schoolA), schoolA.sectionId, sunday);
    expect(register.closure?.kind).toBe("WEEKLY_OFF");
    expect(register.editable).toBe(true);
    expect((await schoolClosureOn(adminOf(schoolA), sunday))?.kind).toBe("WEEKLY_OFF");
  });

  it("will not declare a holiday over marked days without consent, and clears them with it", async () => {
    const day = today();
    const student = schoolA.studentIds[0]!;
    await markAttendance(adminOf(schoolA), {
      sectionId: schoolA.sectionId,
      date: day,
      entries: [{ studentId: student, status: "ABSENT", remarks: null }],
    });
    const before = await studentHistory(adminOf(schoolA), student, schoolA.academicSessionId);

    const input = holiday({ title: "Declared late", startDate: day, endDate: day });
    await expect(saveHoliday(adminOf(schoolA), input)).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.studentAttendance.count({ where: { studentId: student, date: day } })).toBe(1);

    const id = await saveHoliday(adminOf(schoolA), { ...input, clearAttendance: true });
    expect(await prisma.studentAttendance.count({ where: { schoolId: schoolA.schoolId, date: day } })).toBe(0);

    // The absence is gone from the student's record and percentage.
    const after = await studentHistory(adminOf(schoolA), student, schoolA.academicSessionId);
    expect(after.counts.ABSENT).toBe(before.counts.ABSENT - 1);
    expect(after.rows.some((row) => toDateInput(row.date) === toDateInput(day))).toBe(false);

    await deleteHoliday(adminOf(schoolA), id);
  });
});

describe("weekly offs", () => {
  it("defaults to Sunday and can be changed by the admin only", async () => {
    expect(await getWeeklyOffDays(adminOf(schoolA))).toEqual(["SUNDAY"]);
    await setWeeklyOffDays(adminOf(schoolA), { weeklyOffDays: ["SATURDAY", "SUNDAY"] });
    expect(await getWeeklyOffDays(teacherOf(schoolA))).toEqual(["SATURDAY", "SUNDAY"]);
    expect(await getWeeklyOffDays(adminOf(schoolB))).toEqual(["SUNDAY"]);
    await setWeeklyOffDays(adminOf(schoolA), { weeklyOffDays: ["SUNDAY"] });
  });
});

describe("context-aware date rules", () => {
  it("treats a date of birth as history", () => {
    const base = { firstName: "Asha", lastName: "Rao", sectionId: schoolA.sectionId };
    const future = createStudentSchema.safeParse({ ...base, dateOfBirth: toDateInput(addDays(today(), 1)) });
    expect(future.success).toBe(false);
    expect(future.error?.issues.some((issue) => issue.path[0] === "dateOfBirth")).toBe(true);
  });

  it("refuses a new event in the past but lets a past event keep its date", async () => {
    const parse = (date: Date) => eventSchema.parse({ title: "Sports day", date: toDateInput(date) });

    await expect(saveEvent(adminOf(schoolA), parse(addDays(today(), -1)))).rejects.toBeInstanceOf(ValidationError);
    const id = await saveEvent(adminOf(schoolA), parse(today()));

    // Once it has passed, it can still be edited without moving it.
    const past = addDays(today(), -10);
    await prisma.event.updateMany({ where: { id }, data: { date: past } });
    await expect(saveEvent(adminOf(schoolA), { ...parse(past), eventId: id })).resolves.toBe(id);
    // But it cannot be moved to a different past day.
    await expect(saveEvent(adminOf(schoolA), { ...parse(addDays(past, 1)), eventId: id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("allows a schedule date today or later, or unchanged", () => {
    const now = dateOnly(2026, 9, 27);
    expect(isAllowedScheduleDate(dateOnly(2026, 9, 27), null, now)).toBe(true);
    expect(isAllowedScheduleDate(dateOnly(2026, 9, 28), null, now)).toBe(true);
    expect(isAllowedScheduleDate(dateOnly(2026, 9, 26), null, now)).toBe(false);
    expect(isAllowedScheduleDate(dateOnly(2026, 9, 1), dateOnly(2026, 9, 1), now)).toBe(true);
  });
});
