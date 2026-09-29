import "server-only";

import type { DayOfWeek } from "@/generated/prisma/enums";
import { closureOn, type DayClosure, formatSpan, type SchoolCalendar } from "@/lib/calendar";
import { DAY_LABEL, formatDate, isAllowedScheduleDate, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { HolidayInput, WeeklyOffsInput } from "@/lib/validation/calendar";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * School holidays and weekly offs.
 *
 * Only a School Admin changes the calendar. Every signed-in member of the
 * school — teachers, students and parents included — may read it, and reads
 * go through `ctx.db`, so nobody ever sees another school's holidays.
 *
 * The invariant this module keeps: no attendance row exists on a holiday.
 * Marking is refused on one (see the attendance service), and declaring a
 * holiday over days that already have marks requires clearing them in the
 * same transaction. Every attendance figure in the app is computed from
 * recorded marks, so that is what guarantees a holiday is never an absence.
 *
 * Holidays are a forward-looking schedule: one can be declared or moved only
 * onto today or later, and a holiday that has fully ended is locked — it can
 * be neither edited nor deleted, so past registers and reports stay as they
 * were.
 */

/**
 * P2021 / P2022: the `Holiday` table or `School.weeklyOffDays` column is not
 * in this database yet, i.e. migration `20260927100000_holidays_and_weekly_offs`
 * has not been applied. Without the table there are no holidays, so reads fall
 * back to "no holidays, Sunday off" instead of taking down every register and
 * dashboard. Writes still fail, with a message saying what to run.
 */
function isCalendarSchemaMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/**
 * Once the schema is found missing, skip the query for a minute rather than
 * failing (and logging) on every request. Re-checked after that, so applying
 * the migration takes effect without a restart.
 */
const SCHEMA_RECHECK_MS = 60_000;
let schemaMissingUntil = 0;

async function withCalendarFallback<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  if (Date.now() < schemaMissingUntil) return fallback;
  try {
    return await read();
  } catch (error) {
    if (!isCalendarSchemaMissing(error)) throw error;
    schemaMissingUntil = Date.now() + SCHEMA_RECHECK_MS;
    console.warn("[holidays] Calendar tables are missing from this database. Run `npx prisma migrate deploy`.");
    return fallback;
  }
}

async function withCalendarWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isCalendarSchemaMissing(error)) throw error;
    throw new AppError("INTERNAL", "Holidays are not set up in this database yet. Ask the administrator to run the latest migration.");
  }
}

const HOLIDAY_CARD = {
  id: true,
  title: true,
  description: true,
  startDate: true,
  endDate: true,
} as const;

export type Holiday = {
  id: string;
  title: string;
  description: string | null;
  startDate: Date;
  endDate: Date;
};

/** All holidays, optionally only those touching `[from, to]`, oldest first. */
export async function listHolidays(
  ctx: TenantContext,
  range: { from?: Date; to?: Date } = {},
): Promise<Holiday[]> {
  return withCalendarFallback(
    () =>
      ctx.db.holiday.findMany({
        where: {
          ...(range.to ? { startDate: { lte: range.to } } : {}),
          ...(range.from ? { endDate: { gte: range.from } } : {}),
        },
        orderBy: [{ startDate: "asc" }, { title: "asc" }],
        select: HOLIDAY_CARD,
      }),
    [],
  );
}

/** Holidays that are on now or still to come. */
export async function upcomingHolidays(ctx: TenantContext, take = 5): Promise<Holiday[]> {
  return withCalendarFallback(
    () =>
      ctx.db.holiday.findMany({
        where: { endDate: { gte: today() } },
        orderBy: [{ startDate: "asc" }, { title: "asc" }],
        take,
        select: HOLIDAY_CARD,
      }),
    [],
  );
}

export async function getHoliday(ctx: TenantContext, holidayId: string): Promise<Holiday> {
  const holiday = await withCalendarFallback(
    () => ctx.db.holiday.findFirst({ where: { id: holidayId }, select: HOLIDAY_CARD }),
    null,
  );
  if (!holiday) throw new NotFoundError("That holiday was not found.");
  return holiday;
}

export async function getWeeklyOffDays(ctx: TenantContext): Promise<DayOfWeek[]> {
  const school = await withCalendarFallback(
    () => ctx.db.school.findFirst({ select: { weeklyOffDays: true } }),
    null,
  );
  return school?.weeklyOffDays ?? ["SUNDAY"];
}

/** Weekly offs plus the holidays touching `[from, to]`. */
export async function getSchoolCalendar(ctx: TenantContext, from: Date, to: Date): Promise<SchoolCalendar> {
  const [weeklyOffDays, holidays] = await Promise.all([getWeeklyOffDays(ctx), listHolidays(ctx, { from, to })]);
  return { weeklyOffDays, holidays };
}

/** Why the school is closed on `date`, or null if it is a working day. */
export async function schoolClosureOn(ctx: TenantContext, date: Date): Promise<DayClosure | null> {
  return closureOn(await getSchoolCalendar(ctx, date, date), date);
}

async function attendanceInRange(ctx: TenantContext, startDate: Date, endDate: Date) {
  const where = { date: { gte: startDate, lte: endDate } };
  const [students, staff] = await Promise.all([
    ctx.db.studentAttendance.count({ where }),
    ctx.db.teacherAttendance.count({ where }),
  ]);
  return { students, staff, total: students + staff };
}

/** True once every day of the holiday is in the past. */
export function holidayHasEnded(holiday: { endDate: Date }, now: Date = today()): boolean {
  return holiday.endDate < now;
}

/**
 * Create or update a holiday.
 *
 * Only today or later: a new holiday cannot start in the past, and an edit
 * cannot move the start into the past (a holiday already under way keeps its
 * start date). A holiday that has fully ended cannot be edited at all.
 *
 * Overlapping another holiday is refused — two names for the same closed day
 * is a typo, not a calendar. Covering days that already hold attendance is
 * refused too, unless the admin has agreed to clear those marks, in which
 * case the marks are removed and the holiday written in one transaction.
 */
export async function saveHoliday(ctx: TenantContext, input: HolidayInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return withCalendarWrite(() => writeHoliday(ctx, input));
}

async function writeHoliday(ctx: TenantContext, input: HolidayInput): Promise<string> {
  const { holidayId, clearAttendance, ...data } = input;

  const now = today();
  const existing = holidayId ? await getHoliday(ctx, holidayId) : null;
  if (existing && holidayHasEnded(existing, now)) {
    throw new AppError("VALIDATION", `"${existing.title}" has already ended and can no longer be changed.`);
  }
  if (!isAllowedScheduleDate(data.startDate, existing?.startDate, now)) {
    throw new ValidationError("Please correct the highlighted fields.", {
      startDate: ["Choose today or a later date. Past dates cannot be made a holiday."],
    });
  }
  if (data.endDate < now) {
    throw new ValidationError("Please correct the highlighted fields.", {
      endDate: ["Choose today or a later date."],
    });
  }

  const overlapping = await ctx.db.holiday.findFirst({
    where: {
      startDate: { lte: data.endDate },
      endDate: { gte: data.startDate },
      ...(holidayId ? { id: { not: holidayId } } : {}),
    },
    select: { title: true, startDate: true, endDate: true },
  });
  if (overlapping) {
    throw new ConflictError(
      `These dates overlap "${overlapping.title}" (${formatSpan(overlapping.startDate, overlapping.endDate)}). Edit that holiday instead.`,
    );
  }

  const marked = await attendanceInRange(ctx, data.startDate, data.endDate);
  if (marked.total && !clearAttendance) {
    throw new ConflictError(
      `Attendance is already recorded on these dates (${marked.students} student and ${marked.staff} staff marks). ` +
        "Tick “Clear attendance already recorded on these days” to declare the holiday and remove them.",
    );
  }

  const id = await ctx.db.$transaction(async (tx) => {
    if (marked.total) {
      const where = { date: { gte: data.startDate, lte: data.endDate } };
      await tx.studentAttendance.deleteMany({ where });
      await tx.teacherAttendance.deleteMany({ where });
    }
    if (holidayId) {
      await tx.holiday.updateMany({ where: { id: holidayId }, data });
      return holidayId;
    }
    return (await tx.holiday.create({ data: { ...data, schoolId: ctx.schoolId }, select: { id: true } })).id;
  });

  await recordAudit({
    action: holidayId ? "HOLIDAY_UPDATED" : "HOLIDAY_CREATED",
    entityType: "Holiday",
    entityId: id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary:
      `Holiday "${data.title}" ${holidayId ? "updated" : "declared"} for ${formatSpan(data.startDate, data.endDate)}.` +
      (marked.total ? ` Cleared ${marked.students} student and ${marked.staff} staff attendance marks.` : ""),
    metadata: marked.total ? { clearedStudentMarks: marked.students, clearedStaffMarks: marked.staff } : null,
  });

  return id;
}

export async function deleteHoliday(ctx: TenantContext, holidayId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const holiday = await getHoliday(ctx, holidayId);
  if (holidayHasEnded(holiday)) {
    throw new AppError("VALIDATION", `"${holiday.title}" has already ended and can no longer be removed.`);
  }
  await withCalendarWrite(() => ctx.db.holiday.deleteMany({ where: { id: holidayId } }));

  await recordAudit({
    action: "HOLIDAY_DELETED",
    entityType: "Holiday",
    entityId: holidayId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Holiday "${holiday.title}" (${formatSpan(holiday.startDate, holiday.endDate)}) removed.`,
  });
}

export async function setWeeklyOffDays(ctx: TenantContext, input: WeeklyOffsInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await withCalendarWrite(() =>
    ctx.db.school.updateMany({ where: { id: ctx.schoolId }, data: { weeklyOffDays: input.weeklyOffDays } }),
  );

  await recordAudit({
    action: "WEEKLY_OFFS_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: input.weeklyOffDays.length
      ? `Weekly offs set to ${input.weeklyOffDays.map((day) => DAY_LABEL[day]).join(", ")}.`
      : "Weekly offs cleared: the school is open every day.",
  });
}

/** "Holiday: Diwali (10 Nov – 15 Nov 2026)" — for refusal messages. */
export function describeClosure(closure: DayClosure, date: Date): string {
  return closure.kind === "HOLIDAY"
    ? `${formatDate(date)} is a school holiday (${closure.holiday.title}).`
    : `${formatDate(date)} is a weekly off.`;
}
