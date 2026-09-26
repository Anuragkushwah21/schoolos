import type { DayOfWeek } from "@/generated/prisma/enums";

/**
 * Calendar helpers.
 *
 * `@db.Date` columns are stored as UTC midnight, so every "date" in this app is
 * a `Date` at 00:00 UTC whose Y-M-D is the calendar day it names. The school's
 * own calendar decides what "today" is — a teacher marking attendance at 7am in
 * Indore is marking today's register, not yesterday's in UTC.
 */

/** Every school on the platform is in India for V1. */
export const SCHOOL_TIME_ZONE = "Asia/Kolkata";

/** A UTC-midnight Date for the given calendar day. */
export function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Today's calendar date in the school's time zone, as UTC midnight. */
export function today(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return dateOnly(get("year"), get("month"), get("day"));
}

/** `YYYY-MM-DD`, the value an `<input type="date">` expects. */
export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parse `YYYY-MM-DD` into a UTC-midnight Date, or null for anything else.
 * Rejects impossible dates such as 2026-02-30 rather than rolling them over.
 */
export function parseDateInput(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = dateOnly(year, month, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isSameDay(a: Date, b: Date): boolean {
  return toDateInput(a) === toDateInput(b);
}

/** Sunday = 0, matching `Date#getUTCDay`. */
const DAY_BY_INDEX: DayOfWeek[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

export function dayOfWeek(date: Date): DayOfWeek {
  return DAY_BY_INDEX[date.getUTCDay()]!;
}

/** School days in display order. Sunday is omitted from timetables. */
export const WEEKDAYS: DayOfWeek[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

export const DAY_LABEL: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

export const DAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

/** 545 → "09:05". Minutes-from-midnight is how timetable periods are stored. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:05" → 545, or null when the value is not a valid 24-hour time. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number) as [number, number];
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 545 → "9:05 AM". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "18 Sep 2026". Formats the stored calendar day, never shifting it by zone. */
export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** "September 2026". Names the calendar month a stored date falls in. */
export function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** "Fri, 18 Sep". */
export function formatDayShort(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

/** A moment in time (not a calendar day), shown in the school's zone. */
export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: SCHOOL_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
