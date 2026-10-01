import "server-only";

import { SCHOOL_TIME_ZONE, addDays, dayOfWeek, today } from "@/lib/dates";
import { schoolNow } from "@/lib/time-status";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { schoolClosureOn } from "@/server/calendar/holidays";
import { meetingTimeWhere } from "@/server/communication/meetings";
import { listFeePositions } from "@/server/finance/fees";

/** The instant the school's calendar day began (IST has no daylight saving). */
function startOfSchoolDay(): Date {
  const offsetMinutes = SCHOOL_TIME_ZONE === "Asia/Kolkata" ? 330 : 0;
  return new Date(today().getTime() - offsetMinutes * 60_000);
}

/**
 * "What is happening today?" for the School Admin's home screen. Every count
 * is read through `ctx.db`, so it can only ever describe this school.
 */
export async function schoolToday(ctx: TenantContext, academicSessionId: string | null) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const date = today();
  const clock = schoolNow();
  const [staff, payments, homework, closure, periods, meetings, expenses, salary, events] = await Promise.all([
    // Current staff only: people who have left do not count today.
    ctx.db.staffMember.count({ where: { status: { in: [...CURRENT_EMPLOYEE] } } }),
    ctx.db.feePayment.aggregate({ where: { paidOn: date, voidedAt: null }, _sum: { amountMinor: true }, _count: { _all: true } }),
    ctx.db.homework.count({ where: { status: "PUBLISHED", createdAt: { gte: startOfSchoolDay() } } }),
    schoolClosureOn(ctx, date),
    academicSessionId ? ctx.db.timetableSlot.count({ where: { academicSessionId, dayOfWeek: dayOfWeek(date) } }) : Promise.resolve(0),
    ctx.db.meeting.count({ where: { OR: [meetingTimeWhere("UPCOMING", clock), meetingTimeWhere("ONGOING", clock)] } }),
    ctx.db.expense.aggregate({ where: { spentOn: date }, _sum: { amountMinor: true } }),
    ctx.db.salaryPayment.aggregate({ where: { paidOn: date }, _sum: { amountMinor: true }, _count: { _all: true } }),
    ctx.db.event.count({ where: { isPublished: true, date: { gte: date, lte: addDays(date, 14) } } }),
  ]);
  return {
    staff,
    collectionMinor: payments._sum.amountMinor ?? 0,
    paymentCount: payments._count._all,
    homeworkToday: homework,
    // No periods run on a holiday or weekly off.
    classesToday: closure ? 0 : periods,
    upcomingMeetings: meetings,
    expensesMinor: expenses._sum.amountMinor ?? 0,
    salaryMinor: salary._sum.amountMinor ?? 0,
    salaryCount: salary._count._all,
    /** Published events in the next two weeks. */
    upcomingEvents: events,
  };
}

export type AttentionItem = {
  key: "absent" | "registers" | "staff-register" | "missed" | "fees" | "leave" | "admissions" | "complaints";
  count: number;
  /** Money items carry the amount in paise; the screen formats it. */
  amountMinor?: number;
  href: string;
  tone: "red" | "amber" | "orange" | "blue" | "purple";
};

/**
 * Only what needs someone to act, each with the one place to act on it.
 * Nothing here is shown when its count is zero, so an empty list genuinely
 * means "all clear". Every count is read through `ctx.db`.
 */
export async function needsAttention(
  ctx: TenantContext,
  input: { academicSessionId: string | null; registersPending: number; staffMarked: number; closedToday: boolean },
): Promise<AttentionItem[]> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const date = today();
  const [absent, missed, leave, admissions, complaints, fees] = await Promise.all([
    ctx.db.studentAttendance.count({ where: { date, status: "ABSENT" } }),
    ctx.db.classSession.count({ where: { date, status: "MISSED" } }),
    ctx.db.leaveRequest.count({ where: { status: "PENDING" } }),
    ctx.db.admissionApplication.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    ctx.db.complaint.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    input.academicSessionId ? listFeePositions(ctx, { academicSessionId: input.academicSessionId }) : Promise.resolve(null),
  ]);
  const overdue = fees?.totals?.overdue ?? 0;
  const items: AttentionItem[] = [
    { key: "registers", count: input.closedToday ? 0 : input.registersPending, href: "/school-admin/attendance", tone: "amber" },
    { key: "absent", count: absent, href: "/school-admin/attendance/absent", tone: "red" },
    { key: "staff-register", count: !input.closedToday && input.staffMarked === 0 ? 1 : 0, href: "/school-admin/attendance/staff", tone: "amber" },
    { key: "missed", count: missed, href: "/school-admin/substitutes", tone: "red" },
    { key: "fees", count: overdue, amountMinor: fees?.totals?.pendingMinor ?? 0, href: "/school-admin/finance/fees", tone: "orange" },
    { key: "leave", count: leave, href: "/school-admin/leave", tone: "purple" },
    { key: "admissions", count: admissions, href: "/school-admin/admissions", tone: "blue" },
    { key: "complaints", count: complaints, href: "/school-admin/complaints", tone: "red" },
  ];
  return items.filter((item) => item.count > 0);
}
