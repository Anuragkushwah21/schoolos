import "server-only";

import { addDays, today } from "@/lib/dates";
import { attendedShare, emptyCounts } from "@/server/attendance/service";
import type { TenantContext } from "@/server/auth/current-user";
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
  "new-result",
  "new-remark",
  "notice",
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

export async function getParentAlerts(ctx: TenantContext): Promise<ParentAlert[]> {
  const { children } = await listMyChildren(ctx);
  const placed = children.filter((child) => child.sectionId !== null);
  if (placed.length === 0) return [];

  const now = today();
  const studentIds = placed.map((child) => child.id);
  const sectionIds = [...new Set(placed.map((child) => child.sectionId!))];
  const nameOf = new Map(placed.map((child) => [child.id, child.name]));

  const [todayMarks, sessionMarks, dueSoon, freshResults, freshRemarks, notices] = await Promise.all([
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
        assessment: { date: { gte: addDays(now, -RESULT_WINDOW_DAYS) } },
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
        audience: { in: ["ALL", "PARENTS"] },
        OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] }],
        updatedAt: { gte: addDays(now, -NOTICE_WINDOW_DAYS) },
      },
      orderBy: { publishAt: "desc" },
      take: 5,
      select: { id: true, title: true, publishAt: true, createdAt: true },
    }),
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
  return alerts.sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.at.getTime() - a.at.getTime(),
  );
}

function fullTeacher(teacher: { firstName: string; lastName: string }): string {
  return `${teacher.firstName} ${teacher.lastName}`;
}
