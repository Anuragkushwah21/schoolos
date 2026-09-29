import "server-only";

import type { LeaveStatus } from "@/generated/prisma/enums";
import { closureOn, formatSpan, spanDays, workingDays } from "@/lib/calendar";
import { addDays, dayOfWeek, isSameDay, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { leaveStatus } from "@/lib/time-status";
import { fullName, humanize } from "@/lib/format";
import type { LeaveDecisionInput, LeaveRequestInput } from "@/lib/validation/leave";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { getSchoolCalendar } from "@/server/calendar/holidays";

/**
 * Teacher leave: apply, cancel, approve, reject.
 *
 * Date rules (enforced here for the form and the API alike):
 *   * the range cannot end before it starts (also a database constraint);
 *   * it may start up to 30 days back — sick leave is often filed on return —
 *     and at most 180 days ahead;
 *   * one request covers at most 60 days;
 *   * it may not overlap the teacher's own pending or approved leave.
 *
 * Approval writes ON_LEAVE into the staff register for every working day
 * already reached (never over a PRESENT or LATE mark the office entered), and
 * the register pre-fills ON_LEAVE for the days still ahead. Holidays and
 * weekly offs inside the range are not leave days.
 */

export const LEAVE_BACKDATE_DAYS = 30;
export const LEAVE_AHEAD_DAYS = 180;
export const MAX_LEAVE_DAYS = 60;

/** Days either side of today for which cover can be arranged (matches substitutes). */
const COVER_BACK_DAYS = 7;
const COVER_AHEAD_DAYS = 14;

const LEAVE_SELECT = {
  id: true,
  type: true,
  startDate: true,
  endDate: true,
  reason: true,
  status: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
  teacherId: true,
  teacher: { select: { firstName: true, lastName: true, employeeId: true } },
  reviewedBy: { select: { firstName: true, lastName: true } },
} as const;

async function withWorkingDays<T extends { startDate: Date; endDate: Date; status: LeaveStatus }>(ctx: TenantContext, rows: T[]) {
  if (!rows.length) return [];
  const from = rows.reduce((min, row) => (row.startDate < min ? row.startDate : min), rows[0]!.startDate);
  const to = rows.reduce((max, row) => (row.endDate > max ? row.endDate : max), rows[0]!.endDate);
  const calendar = await getSchoolCalendar(ctx, from, to);
  const now = today();
  return rows.map((row) => ({
    ...row,
    days: workingDays(calendar, row.startDate, row.endDate).length,
    /** PENDING/REJECTED/CANCELLED as decided; approved leave is UPCOMING, ON_LEAVE or COMPLETED by date. */
    timeStatus: leaveStatus(row.status, row.startDate, row.endDate, now),
  }));
}

export async function applyForLeave(ctx: TenantContext, input: LeaveRequestInput): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const now = today();

  const errors: Record<string, string[]> = {};
  if (input.startDate < addDays(now, -LEAVE_BACKDATE_DAYS)) {
    errors.startDate = [`Leave can be filed for at most ${LEAVE_BACKDATE_DAYS} days back.`];
  }
  if (input.startDate > addDays(now, LEAVE_AHEAD_DAYS)) {
    errors.startDate = [`Leave can be requested at most ${LEAVE_AHEAD_DAYS} days ahead.`];
  }
  if (input.endDate < input.startDate) errors.endDate = ["Leave cannot end before it starts."];
  else if (spanDays(input.startDate, input.endDate) > MAX_LEAVE_DAYS) {
    errors.endDate = [`One request can cover at most ${MAX_LEAVE_DAYS} days. Split longer leave into parts.`];
  }
  if (Object.keys(errors).length) throw new ValidationError("Please correct the highlighted fields.", errors);

  const overlap = await ctx.db.leaveRequest.findFirst({
    where: {
      teacherId: teacher.id,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: input.endDate },
      endDate: { gte: input.startDate },
    },
    select: { startDate: true, endDate: true, status: true },
  });
  if (overlap) {
    throw new ConflictError(
      `You already have ${overlap.status.toLowerCase()} leave for ${formatSpan(overlap.startDate, overlap.endDate)}.`,
    );
  }

  const created = await ctx.db.leaveRequest.create({
    data: {
      schoolId: ctx.schoolId,
      teacherId: teacher.id,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
    },
    select: { id: true },
  });

  await recordAudit({
    action: "LEAVE_REQUESTED",
    entityType: "LeaveRequest",
    entityId: created.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(teacher)} requested ${humanize(input.type).toLowerCase()} leave for ${formatSpan(input.startDate, input.endDate)}.`,
  });
  return created;
}

export async function cancelLeave(ctx: TenantContext, leaveId: string): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const leave = await ctx.db.leaveRequest.findFirst({
    where: { id: leaveId, teacherId: teacher.id },
    select: { id: true, status: true, startDate: true, endDate: true },
  });
  // Another teacher's request answers exactly like a missing one.
  if (!leave) throw new NotFoundError("That leave request was not found.");
  const cancellable = leave.status === "PENDING" || (leave.status === "APPROVED" && leave.startDate > today());
  if (!cancellable) {
    throw new AppError("VALIDATION", "Only pending leave, or approved leave that has not started, can be cancelled.");
  }

  await ctx.db.leaveRequest.updateMany({ where: { id: leave.id }, data: { status: "CANCELLED" } });
  await recordAudit({
    action: "LEAVE_CANCELLED",
    entityType: "LeaveRequest",
    entityId: leave.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(teacher)} cancelled leave for ${formatSpan(leave.startDate, leave.endDate)}.`,
  });
}

export async function listMyLeave(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const rows = await ctx.db.leaveRequest.findMany({
    where: { teacherId: teacher.id },
    orderBy: { startDate: "desc" },
    take: 100,
    select: LEAVE_SELECT,
  });
  const now = today();
  return (await withWorkingDays(ctx, rows)).map((row) => ({
    ...row,
    cancellable: row.status === "PENDING" || (row.status === "APPROVED" && row.startDate > now),
  }));
}

export async function listLeaveRequests(
  ctx: TenantContext,
  filters: { status?: LeaveStatus; teacherId?: string } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.leaveRequest.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
    },
    orderBy: [{ status: "asc" }, { startDate: "asc" }],
    take: 200,
    select: LEAVE_SELECT,
  });
  return withWorkingDays(ctx, rows);
}

/**
 * Periods a leave takes a teacher out of, within the window cover can be
 * arranged for, with any cover already in place.
 */
export async function affectedPeriods(ctx: TenantContext, teacherId: string, startDate: Date, endDate: Date) {
  const now = today();
  const from = startDate > addDays(now, -COVER_BACK_DAYS) ? startDate : addDays(now, -COVER_BACK_DAYS);
  const to = endDate < addDays(now, COVER_AHEAD_DAYS) ? endDate : addDays(now, COVER_AHEAD_DAYS);
  if (from > to) return [];

  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) return [];

  const [calendar, slots, covers] = await Promise.all([
    getSchoolCalendar(ctx, from, to),
    ctx.db.timetableSlot.findMany({
      where: { teacherId, academicSessionId: session.id },
      orderBy: { startMinute: "asc" },
      select: {
        id: true,
        dayOfWeek: true,
        startMinute: true,
        endMinute: true,
        room: true,
        subject: { select: { name: true } },
        section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
      },
    }),
    ctx.db.classSession.findMany({
      where: { scheduledTeacherId: teacherId, date: { gte: from, lte: to }, status: "SUBSTITUTE" },
      select: { id: true, timetableSlotId: true, date: true, actualTeacher: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const periods: Array<{
    date: Date;
    slotId: string;
    startMinute: number;
    endMinute: number;
    subject: string;
    section: string;
    room: string | null;
    cover: { classSessionId: string; teacher: string } | null;
  }> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (closureOn(calendar, date)) continue;
    for (const slot of slots.filter((row) => row.dayOfWeek === dayOfWeek(date))) {
      const cover = covers.find((row) => row.timetableSlotId === slot.id && isSameDay(row.date, date));
      periods.push({
        date,
        slotId: slot.id,
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        subject: slot.subject.name,
        section: sectionLabel(slot.section),
        room: slot.room,
        cover: cover?.actualTeacher ? { classSessionId: cover.id, teacher: fullName(cover.actualTeacher) } : null,
      });
    }
  }
  return periods;
}

export async function getLeaveRequest(ctx: TenantContext, leaveId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const leave = await ctx.db.leaveRequest.findFirst({ where: { id: leaveId }, select: LEAVE_SELECT });
  if (!leave) throw new NotFoundError("That leave request was not found.");
  const [withDays] = await withWorkingDays(ctx, [leave]);
  const periods =
    leave.status === "PENDING" || leave.status === "APPROVED"
      ? await affectedPeriods(ctx, leave.teacherId, leave.startDate, leave.endDate)
      : [];
  return { leave: withDays!, periods };
}

/**
 * Approve or reject one or more pending requests. All must be pending, or
 * none is decided. Approving writes ON_LEAVE for the working days already
 * reached, in the same transaction.
 */
export async function decideLeave(ctx: TenantContext, input: LeaveDecisionInput): Promise<{ decided: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const ids = [...new Set(input.leaveIds)];
  const requests = await ctx.db.leaveRequest.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, teacherId: true, startDate: true, endDate: true, type: true, teacher: { select: { firstName: true, lastName: true } } },
  });
  if (requests.length !== ids.length) throw new NotFoundError("A leave request was not found.");
  const decided = requests.filter((row) => row.status !== "PENDING");
  if (decided.length) {
    throw new ConflictError(
      `${decided.length} of these request${decided.length > 1 ? "s have" : " has"} already been decided. Refresh and try again.`,
    );
  }
  if (input.decision === "REJECTED" && !input.note) {
    throw new ValidationError("Please correct the highlighted fields.", { note: ["Say why the leave is refused."] });
  }

  const now = today();
  const approving = input.decision === "APPROVED";
  const markDays = new Map<string, Date[]>();
  if (approving) {
    const from = requests.reduce((min, row) => (row.startDate < min ? row.startDate : min), requests[0]!.startDate);
    const calendar = await getSchoolCalendar(ctx, from, now);
    for (const row of requests) {
      if (row.startDate > now) continue;
      const end = row.endDate < now ? row.endDate : now;
      markDays.set(row.id, workingDays(calendar, row.startDate, end));
    }
  }

  await ctx.db.$transaction(async (tx) => {
    await tx.leaveRequest.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: input.decision, reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note },
    });
    for (const row of requests) {
      for (const date of markDays.get(row.id) ?? []) {
        const existing = await tx.teacherAttendance.findFirst({
          where: { teacherId: row.teacherId, date },
          select: { id: true, status: true },
        });
        // The office's own PRESENT or LATE mark wins: they saw the teacher.
        if (existing && (existing.status === "PRESENT" || existing.status === "LATE")) continue;
        if (existing) {
          await tx.teacherAttendance.updateMany({ where: { id: existing.id }, data: { status: "ON_LEAVE", remarks: `${humanize(row.type)} leave` } });
        } else {
          await tx.teacherAttendance.create({
            data: { schoolId: ctx.schoolId, teacherId: row.teacherId, date, status: "ON_LEAVE", remarks: `${humanize(row.type)} leave` },
          });
        }
      }
    }
  });

  for (const row of requests) {
    await recordAudit({
      action: approving ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
      entityType: "LeaveRequest",
      entityId: row.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Leave for ${fullName(row.teacher)} (${formatSpan(row.startDate, row.endDate)}) ${approving ? "approved" : "rejected"}.`,
    });
  }
  return { decided: requests.length };
}

/** Teachers on approved leave on `date`, by teacher id — for the staff register and cover planning. */
export async function approvedLeaveOn(ctx: TenantContext, date: Date) {
  const rows = await ctx.db.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
    select: { teacherId: true, type: true, startDate: true, endDate: true },
  });
  return new Map(rows.map((row) => [row.teacherId, row]));
}

export function leaveLabel(leave: { type: string; startDate: Date; endDate: Date }): string {
  return `${humanize(leave.type)} leave, ${formatSpan(leave.startDate, leave.endDate)}`;
}

