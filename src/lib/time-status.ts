import { SCHOOL_TIME_ZONE, today } from "@/lib/dates";

/**
 * Where a dated record stands in time, worked out from the school's clock on
 * every read. Nothing here is stored: a status that follows from the date
 * cannot go stale, and nobody has to remember to flip it after the day passes.
 *
 * These are *time* statuses. The manual states a record carries — DRAFT,
 * PUBLISHED, CANCELLED, REJECTED, ARCHIVED — are kept alongside, never
 * replaced, and each module decides which one wins on screen.
 *
 * All dates are UTC-midnight calendar days (see `lib/dates.ts`); times are
 * minutes from midnight in the school's own zone.
 */

export type Tone = "positive" | "warning" | "negative" | "info" | "neutral";

/** The school's calendar day and wall-clock minute, right now. */
export function schoolNow(now: Date = new Date()): { date: Date; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHOOL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { date: today(now), minutes: get("hour") * 60 + get("minute") };
}

const before = (a: Date, b: Date) => a.getTime() < b.getTime();
const same = (a: Date, b: Date) => a.getTime() === b.getTime();

// --- a span of whole days: exams, holidays, leave ---------------------------------

export type SpanStatus = "UPCOMING" | "ONGOING" | "COMPLETED";

/** Before the first day, on any day of it, or after the last. Both ends inclusive. */
export function spanStatus(startDate: Date, endDate: Date, on: Date = today()): SpanStatus {
  if (before(on, startDate)) return "UPCOMING";
  if (before(endDate, on)) return "COMPLETED";
  return "ONGOING";
}

// --- one day with optional times: events, PTMs -------------------------------------

export type SessionStatus = "UPCOMING" | "TODAY" | "ONGOING" | "COMPLETED";

/**
 * A single-day happening. Later today but not yet started is TODAY; between
 * its start and end is ONGOING. Without times, the whole day is TODAY and it
 * is COMPLETED from the next day.
 */
export function sessionStatus(
  date: Date,
  startMinute: number | null,
  endMinute: number | null,
  clock: { date: Date; minutes: number } = schoolNow(),
): SessionStatus {
  if (before(clock.date, date)) return "UPCOMING";
  if (before(date, clock.date)) return "COMPLETED";
  if (endMinute !== null && clock.minutes >= endMinute) return "COMPLETED";
  if (startMinute !== null && clock.minutes >= startMinute) return "ONGOING";
  return "TODAY";
}

// --- meetings -----------------------------------------------------------------------

export type MeetingTimeStatus = "UPCOMING" | "ONGOING" | "COMPLETED" | "CANCELLED";

/**
 * A meeting the office has not cancelled is UPCOMING until it starts, ONGOING
 * until it ends, and COMPLETED after. Without an end time it runs to the end
 * of its day, the same rule `sessionStatus` uses for events. CANCELLED is the
 * office's decision and wins over the clock.
 */
export function meetingStatus(
  meeting: { status: "SCHEDULED" | "CANCELLED"; date: Date; startMinute: number; endMinute: number | null },
  clock: { date: Date; minutes: number } = schoolNow(),
): MeetingTimeStatus {
  if (meeting.status === "CANCELLED") return "CANCELLED";
  const time = sessionStatus(meeting.date, meeting.startMinute, meeting.endMinute, clock);
  return time === "TODAY" ? "UPCOMING" : time;
}

// --- homework ------------------------------------------------------------------------

export type HomeworkTimeStatus = "ASSIGNED" | "DUE_TODAY" | "OVERDUE";

export function homeworkStatus(dueOn: Date, on: Date = today()): HomeworkTimeStatus {
  if (before(dueOn, on)) return "OVERDUE";
  if (same(dueOn, on)) return "DUE_TODAY";
  return "ASSIGNED";
}

// --- leave ---------------------------------------------------------------------------

export type LeaveTimeStatus = "PENDING" | "REJECTED" | "CANCELLED" | "UPCOMING" | "ON_LEAVE" | "COMPLETED";

/** Only approved leave moves with the calendar; the other states are decisions and stay. */
export function leaveStatus(status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED", startDate: Date, endDate: Date, on: Date = today()): LeaveTimeStatus {
  if (status !== "APPROVED") return status;
  const span = spanStatus(startDate, endDate, on);
  return span === "ONGOING" ? "ON_LEAVE" : span;
}

// --- notices -------------------------------------------------------------------------

export type NoticeTimeStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "EXPIRED" | "ARCHIVED";

/**
 * A published notice is SCHEDULED before its publish day, ACTIVE through its
 * "hide after" day (inclusive), and EXPIRED after it. DRAFT and ARCHIVED are
 * the office's own choices and win.
 */
export function noticeStatus(
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED",
  publishAt: Date | null,
  expiresAt: Date | null,
  on: Date = today(),
): NoticeTimeStatus {
  if (status !== "PUBLISHED") return status;
  if (publishAt && before(on, dayOf(publishAt))) return "SCHEDULED";
  if (expiresAt && before(dayOf(expiresAt), on)) return "EXPIRED";
  return "ACTIVE";
}

/** The calendar day a stored timestamp falls on, in the school's zone. */
function dayOf(value: Date): Date {
  return today(value);
}

// --- labels and tones, shared by every screen ------------------------------------------

export const TIME_STATUS_LABEL: Record<string, string> = {
  UPCOMING: "Upcoming",
  TODAY: "Today",
  ONGOING: "Ongoing",
  COMPLETED: "Completed",
  ASSIGNED: "Assigned",
  DUE_TODAY: "Due today",
  OVERDUE: "Overdue",
  ON_LEAVE: "On leave now",
  PENDING: "Pending",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  ARCHIVED: "Archived",
  PAST: "Past",
};

export const TIME_STATUS_TONE: Record<string, Tone> = {
  UPCOMING: "info",
  TODAY: "warning",
  ONGOING: "positive",
  COMPLETED: "neutral",
  ASSIGNED: "info",
  DUE_TODAY: "warning",
  OVERDUE: "negative",
  ON_LEAVE: "warning",
  PENDING: "warning",
  REJECTED: "negative",
  CANCELLED: "neutral",
  DRAFT: "neutral",
  SCHEDULED: "info",
  ACTIVE: "positive",
  EXPIRED: "neutral",
  ARCHIVED: "neutral",
  PAST: "neutral",
};
