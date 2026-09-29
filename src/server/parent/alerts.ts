import "server-only";

import { formatSpan } from "@/lib/calendar";
import { addDays, formatDate, today } from "@/lib/dates";
import { attendedShare, emptyCounts } from "@/server/attendance/service";
import type { TenantContext } from "@/server/auth/current-user";
import { upcomingHolidays } from "@/server/calendar/holidays";
import { meetingAlerts } from "@/server/communication/meetings";
import { visibleNoticeWhere } from "@/server/communication/notices";
import { parentSupportAlerts } from "@/server/support/service";
import { VISIBLE_PAPER } from "@/server/exams/service";
import { readStudentFees } from "@/server/finance/fees";
import { LOW_ATTENDANCE_THRESHOLD } from "@/server/parent/child";
import { listMyChildren } from "@/server/parent/access";

/**
 * What a guardian would want to be told without going looking.
 *
 * Every alert is derived from a row a teacher or the office actually wrote:
 * a register marked absent, a due date set, a mark entered, a remark saved, a
 * notice published. Nothing is invented and nothing is stored — there is no
 * notification table, so an alert cannot go stale or contradict the record it
 * came from. It is recomputed on each read, which for a handful of children is
 * a few indexed queries.
 *
 * Deliberately not a feed of everything: the cut-offs below are what makes this
 * worth reading, and a list that shows every event is one a parent stops
 * opening.
 */

export const ALERT_KINDS = [
  "absent-today",
  "low-attendance",
  "homework-due",
  "new-homework",
  "new-result",
  "new-remark",
  "notice",
  "fee-due",
  "holiday",
  "results-published",
  "meeting",
  "support",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export type ParentAlert = {
  kind: AlertKind;
  /** Null for a school-wide alert that is not about one child. */
  childId: string | null;
  childName: string | null;
  title: string;
  detail: string;
  /** What the alert is about, newest first. */
  at: Date;
  href: string | null;
  tone: "critical" | "warning" | "info";
};

/** How recently something must have happened to still be worth surfacing. */
const RESULT_WINDOW_DAYS = 7;
const REMARK_WINDOW_DAYS = 7;
const NOTICE_WINDOW_DAYS = 7;
/** Homework set this recently is "new", even if it is not due for a while. */
const NEW_HOMEWORK_DAYS = 2;
/** Fees falling due this soon are worth a reminder before they are late. */
const FEE_REMINDER_DAYS = 7;
/** Holidays starting this soon are announced on the dashboard. */
const HOLIDAY_NOTICE_DAYS = 14;

function rupeesText(minor: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(minor / 100);
}

export async function getParentAlerts(ctx: TenantContext): Promise<ParentAlert[]> {
  const { children } = await listMyChildren(ctx);
  const placed = children.filter((child) => child.sectionId !== null);
  if (placed.length === 0) return [];

  const now = today();
  const studentIds = placed.map((child) => child.id);
  const sectionIds = [...new Set(placed.map((child) => child.sectionId!))];
  const nameOf = new Map(placed.map((child) => [child.id, child.name]));

  const [todayMarks, sessionMarks, dueSoon, freshResults, freshRemarks, notices, newHomework, holidays, fees, exams, meetings] = await Promise.all([
    ctx.db.studentAttendance.findMany({
      where: { studentId: { in: studentIds }, date: now },
      select: { studentId: true, status: true },
    }),
    ctx.db.studentAttendance.groupBy({
      by: ["studentId", "status"],
      where: { studentId: { in: studentIds }, academicSession: { isCurrent: true } },
      _count: { _all: true },
    }),
    ctx.db.homework.findMany({
      where: {
        sectionId: { in: sectionIds },
        status: "PUBLISHED",
        dueOn: { gte: now, lte: addDays(now, 1) },
      },
      orderBy: { dueOn: "asc" },
      select: {
        id: true,
        title: true,
        dueOn: true,
        sectionId: true,
        subject: { select: { name: true } },
      },
    }),
    ctx.db.assessmentResult.findMany({
      where: {
        studentId: { in: studentIds },
        marksObtained: { not: null },
        assessment: { date: { gte: addDays(now, -RESULT_WINDOW_DAYS) }, ...VISIBLE_PAPER },
      },
      orderBy: { assessment: { date: "desc" } },
      take: 10,
      select: {
        studentId: true,
        marksObtained: true,
        assessment: {
          select: { name: true, date: true, maxMarks: true, subject: { select: { name: true } } },
        },
      },
    }),
    ctx.db.studentRemark.findMany({
      where: {
        studentId: { in: studentIds },
        createdAt: { gte: addDays(now, -REMARK_WINDOW_DAYS) },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        studentId: true,
        createdAt: true,
        understanding: true,
        teacher: { select: { firstName: true, lastName: true } },
      },
    }),
    ctx.db.notice.findMany({
      where: {
        status: "PUBLISHED",
        OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }, await visibleNoticeWhere(ctx)],
        updatedAt: { gte: addDays(now, -NOTICE_WINDOW_DAYS) },
      },
      orderBy: { publishAt: "desc" },
      take: 5,
      select: { id: true, title: true, publishAt: true, createdAt: true },
    }),
    ctx.db.homework.findMany({
      where: {
        sectionId: { in: sectionIds },
        status: "PUBLISHED",
        createdAt: { gte: addDays(now, -NEW_HOMEWORK_DAYS) },
        dueOn: { gt: addDays(now, 1) },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, dueOn: true, createdAt: true, sectionId: true, subject: { select: { name: true } } },
    }),
    upcomingHolidays(ctx, 5),
    // Each child's own fee account, read after `listMyChildren` has resolved
    // them through the guardian link — never another family's.
    Promise.all(placed.map(async (child) => ({ child, account: await readStudentFees(ctx, child.id) }))),
    ctx.db.exam.findMany({
      where: { sectionId: { in: sectionIds }, status: "PUBLISHED", publishedAt: { gte: addDays(now, -RESULT_WINDOW_DAYS) } },
      select: { id: true, name: true, sectionId: true, publishedAt: true },
    }),
    meetingAlerts(ctx, "/parent/meetings"),
  ]);

  const alerts: ParentAlert[] = [];

  // --- absent today: the one thing a parent wants to know the same day -------
  for (const mark of todayMarks) {
    if (mark.status !== "ABSENT") continue;
    alerts.push({
      kind: "absent-today",
      childId: mark.studentId,
      childName: nameOf.get(mark.studentId) ?? null,
      title: `${nameOf.get(mark.studentId)} was marked absent today`,
      detail: "If this is wrong, the school office can correct the register.",
      at: now,
      href: `/parent/children/${mark.studentId}/attendance`,
      tone: "critical",
    });
  }

  // --- low attendance across the session ------------------------------------
  const counts = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const row of sessionMarks) {
    const entry = counts.get(row.studentId) ?? emptyCounts();
    entry[row.status] += row._count._all;
    entry.total += row._count._all;
    counts.set(row.studentId, entry);
  }
  for (const [studentId, tally] of counts) {
    const share = attendedShare(tally);
    // Below the threshold, and on enough days for the figure to mean something.
    if (share === null || share >= LOW_ATTENDANCE_THRESHOLD || tally.total < 10) continue;
    alerts.push({
      kind: "low-attendance",
      childId: studentId,
      childName: nameOf.get(studentId) ?? null,
      title: `${nameOf.get(studentId)}'s attendance is ${Math.round(share * 100)}%`,
      detail: `${tally.ABSENT} days absent of ${tally.total} marked, against a ${Math.round(LOW_ATTENDANCE_THRESHOLD * 100)}% expectation.`,
      at: now,
      href: `/parent/children/${studentId}/attendance`,
      tone: "warning",
    });
  }

  // --- homework due today or tomorrow ---------------------------------------
  for (const work of dueSoon) {
    for (const child of placed.filter((c) => c.sectionId === work.sectionId)) {
      alerts.push({
        kind: "homework-due",
        childId: child.id,
        childName: child.name,
        title: `${work.subject.name}: ${work.title}`,
        detail:
          work.dueOn.getTime() === now.getTime()
            ? `Due today for ${child.name}.`
            : `Due tomorrow for ${child.name}.`,
        at: work.dueOn,
        href: `/parent/children/${child.id}/homework`,
        tone: work.dueOn.getTime() === now.getTime() ? "warning" : "info",
      });
    }
  }

  // --- a mark that has just come in -----------------------------------------
  for (const result of freshResults) {
    const percent =
      result.assessment.maxMarks === 0 || result.marksObtained === null
        ? null
        : Math.round((result.marksObtained / result.assessment.maxMarks) * 100);
    alerts.push({
      kind: "new-result",
      childId: result.studentId,
      childName: nameOf.get(result.studentId) ?? null,
      title: `${result.assessment.subject.name}: ${result.assessment.name}`,
      detail: `${nameOf.get(result.studentId)} scored ${result.marksObtained}/${result.assessment.maxMarks}${percent === null ? "" : ` (${percent}%)`}.`,
      at: result.assessment.date,
      href: `/parent/children/${result.studentId}/results`,
      tone: percent !== null && percent < 40 ? "warning" : "info",
    });
  }

  // --- a teacher has written something --------------------------------------
  for (const remark of freshRemarks) {
    alerts.push({
      kind: "new-remark",
      childId: remark.studentId,
      childName: nameOf.get(remark.studentId) ?? null,
      title: `${fullTeacher(remark.teacher)} wrote about ${nameOf.get(remark.studentId)}`,
      detail: remark.understanding
        ? `Academic understanding recorded as ${remark.understanding.toLowerCase().replace(/_/g, " ")}.`
        : "A new observation is on the record.",
      at: remark.createdAt,
      href: `/parent/children/${remark.studentId}/remarks`,
      tone: remark.understanding === "NEEDS_ATTENTION" ? "warning" : "info",
    });
  }

  // --- a parent-teacher meeting coming up ----------------------------------
  // --- meetings the school has invited this family to ------------------------
  for (const meeting of meetings) alerts.push({ ...meeting, childName: null });

  // --- exam results just published -----------------------------------------
  for (const exam of exams) {
    for (const child of placed.filter((c) => c.sectionId === exam.sectionId)) {
      alerts.push({
        kind: "results-published",
        childId: child.id,
        childName: child.name,
        title: `${exam.name} results are out for ${child.name}`,
        detail: "The report card is on the results page.",
        at: exam.publishedAt ?? now,
        href: `/parent/children/${child.id}/results`,
        tone: "info",
      });
    }
  }

  // --- homework just set (due later than tomorrow; sooner is "homework-due") --
  for (const work of newHomework) {
    for (const child of placed.filter((c) => c.sectionId === work.sectionId)) {
      alerts.push({
        kind: "new-homework",
        childId: child.id,
        childName: child.name,
        title: `New homework — ${work.subject.name}: ${work.title}`,
        detail: `Set for ${child.name}, due ${formatDate(work.dueOn)}.`,
        at: work.createdAt,
        href: `/parent/children/${child.id}/homework`,
        tone: "info",
      });
    }
  }

  // --- fees overdue, or due within the week ---------------------------------
  for (const { child, account } of fees) {
    const { summary } = account;
    if (summary.pendingMinor <= 0 || !summary.dueOn) continue;
    if (summary.overdue) {
      alerts.push({
        kind: "fee-due",
        childId: child.id,
        childName: child.name,
        title: `${rupeesText(summary.pendingMinor)} fees overdue for ${child.name}`,
        detail: `Was due on ${formatDate(summary.dueOn)}. Please contact the school office.`,
        at: summary.dueOn,
        href: `/parent/children/${child.id}/fees`,
        tone: "warning",
      });
    } else if (summary.dueOn <= addDays(now, FEE_REMINDER_DAYS)) {
      alerts.push({
        kind: "fee-due",
        childId: child.id,
        childName: child.name,
        title: `${rupeesText(summary.pendingMinor)} fees due for ${child.name}`,
        detail: `Due on ${formatDate(summary.dueOn)}.`,
        at: summary.dueOn,
        href: `/parent/children/${child.id}/fees`,
        tone: "info",
      });
    }
  }

  // --- holidays coming up ---------------------------------------------------
  for (const holiday of holidays) {
    if (holiday.startDate > addDays(now, HOLIDAY_NOTICE_DAYS)) continue;
    const running = holiday.startDate <= now;
    alerts.push({
      kind: "holiday",
      childId: null,
      childName: null,
      title: running ? `School closed: ${holiday.title}` : `Holiday: ${holiday.title}`,
      detail: `${formatSpan(holiday.startDate, holiday.endDate)}. No classes or attendance.`,
      at: holiday.startDate,
      href: "/parent/holidays",
      tone: "info",
    });
  }

  // --- school notices -------------------------------------------------------
  for (const notice of notices) {
    alerts.push({
      kind: "notice",
      childId: null,
      childName: null,
      title: notice.title,
      detail: "From the school office.",
      at: notice.publishAt ?? notice.createdAt,
      href: "/parent/notices",
      tone: "info",
    });
  }

  const TONE_ORDER = { critical: 0, warning: 1, info: 2 } as const;
  // --- support: concerns reviewed and help arranged ----------------------------
  alerts.push(...(await parentSupportAlerts(ctx, placed)));

  return alerts.sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.at.getTime() - a.at.getTime(),
  );
}

function fullTeacher(teacher: { firstName: string; lastName: string }): string {
  return `${teacher.firstName} ${teacher.lastName}`;
}
