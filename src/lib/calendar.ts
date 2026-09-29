import type { DayOfWeek } from "@/generated/prisma/enums";
import { addDays, DAY_LABEL, dayOfWeek, toDateInput } from "@/lib/dates";

/**
 * A school's working calendar: which days it is closed.
 *
 * Two sources close a day — a declared `Holiday` (one day or a run of days)
 * and the school's weekly offs (Sunday by default). They are treated
 * differently on purpose:
 *
 *   * A holiday is a decision that the school is shut. Attendance is refused
 *     on it, and no attendance row may exist on it.
 *   * A weekly off is the normal pattern. Attendance is not expected, but a
 *     school holding a special Saturday or Sunday class may still record it,
 *     and those marks count like any other day's.
 *
 * Pure functions only, so the same rules run on the server, in tests and in
 * the browser.
 */

export type HolidaySpan = {
  id: string;
  title: string;
  description?: string | null;
  /** UTC-midnight, inclusive. */
  startDate: Date;
  /** UTC-midnight, inclusive. */
  endDate: Date;
};

export type SchoolCalendar = {
  weeklyOffDays: readonly DayOfWeek[];
  holidays: readonly HolidaySpan[];
};

export type DayClosure =
  | { kind: "HOLIDAY"; holiday: HolidaySpan; label: string }
  | { kind: "WEEKLY_OFF"; day: DayOfWeek; label: string };

/** Longest single holiday accepted — long enough for a summer vacation. */
export const MAX_HOLIDAY_DAYS = 120;

export function holidayOn(holidays: readonly HolidaySpan[], date: Date): HolidaySpan | null {
  return holidays.find((holiday) => holiday.startDate <= date && date <= holiday.endDate) ?? null;
}

/** Why the school is closed on `date`, or null on a normal working day. */
export function closureOn(calendar: SchoolCalendar, date: Date): DayClosure | null {
  const holiday = holidayOn(calendar.holidays, date);
  if (holiday) return { kind: "HOLIDAY", holiday, label: `Holiday: ${holiday.title}` };

  const day = dayOfWeek(date);
  if (calendar.weeklyOffDays.includes(day)) {
    return { kind: "WEEKLY_OFF", day, label: `${DAY_LABEL[day]} is a weekly off` };
  }
  return null;
}

/** Inclusive number of calendar days in a span. */
export function spanDays(startDate: Date, endDate: Date): number {
  return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

/** Every calendar day from `from` to `to`, both inclusive. */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push(date);
  return days;
}

/**
 * Working days in a range: every day that is neither a holiday nor a weekly
 * off. The denominator a "days the school was open" figure should use.
 */
export function workingDays(calendar: SchoolCalendar, from: Date, to: Date): Date[] {
  return eachDay(from, to).filter((date) => !closureOn(calendar, date));
}

/** Holiday days (not weekly offs) inside a range, as `YYYY-MM-DD` keys. */
export function holidayKeys(calendar: SchoolCalendar, from: Date, to: Date): Set<string> {
  const keys = new Set<string>();
  for (const holiday of calendar.holidays) {
    const start = holiday.startDate > from ? holiday.startDate : from;
    const end = holiday.endDate < to ? holiday.endDate : to;
    for (const date of eachDay(start, end)) keys.add(toDateInput(date));
  }
  return keys;
}

/** "10 Nov 2026" for one day, "10 Nov – 15 Nov 2026" for a run. */
export function formatSpan(startDate: Date, endDate: Date): string {
  const fmt = (date: Date, withYear: boolean) =>
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(date);

  if (toDateInput(startDate) === toDateInput(endDate)) return fmt(startDate, true);
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  return `${fmt(startDate, !sameYear)} – ${fmt(endDate, true)}`;
}
