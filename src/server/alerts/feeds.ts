import "server-only";

import { formatSpan } from "@/lib/calendar";
import { addDays, formatDate, formatDayShort, formatMinutes, today } from "@/lib/dates";
import { fullName, humanize } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { upcomingHolidays } from "@/server/calendar/holidays";
import { meetingAlerts } from "@/server/communication/meetings";
import { visibleNoticeWhere } from "@/server/communication/notices";
import { studentSupportAlerts, teacherSupportAlerts } from "@/server/support/service";
import { VISIBLE_PAPER } from "@/server/exams/service";
import { findStudentSelf } from "@/server/student/access";

/**
 * Alert feeds for students and teachers, in the same spirit as the parent
 * feed (`server/parent/alerts.ts`): every alert is derived from a row someone
 * wrote, nothing is stored, and short windows keep it worth reading.
 */

export type FeedAlert = {
  kind: string;
  childId: string | null;
  title: string;
  detail: string;
  at: Date;
  href: string | null;
  tone: "critical" | "warning" | "info";
};

const WINDOW_DAYS = 7;
const HOLIDAY_NOTICE_DAYS = 14;
const TONE_ORDER = { critical: 0, warning: 1, info: 2 } as const;

function sortAlerts(alerts: FeedAlert[]): FeedAlert[] {
  return alerts.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.at.getTime() - a.at.getTime());
}

async function sharedAlerts(ctx: TenantContext, noticesHref: string, holidaysHref: string | null, meetingsHref: string): Promise<FeedAlert[]> {
  const now = today();
  const [notices, holidays, meetings] = await Promise.all([
    ctx.db.notice.findMany({
      where: {
        status: "PUBLISHED",
        updatedAt: { gte: addDays(now, -WINDOW_DAYS) },
        AND: [
          { OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
          await visibleNoticeWhere(ctx),
        ],
      },
      orderBy: { publishAt: "desc" },
      take: 5,
      select: { title: true, publishAt: true, createdAt: true },
    }),
    holidaysHref ? upcomingHolidays(ctx, 5) : [],
    meetingAlerts(ctx, meetingsHref),
  ]);
  return [
    ...meetings,
    ...notices.map((notice) => ({
      kind: "notice",
      childId: null,
      title: notice.title,
      detail: "From the school office.",
      at: notice.publishAt ?? notice.createdAt,
      href: noticesHref,
      tone: "info" as const,
    })),
    ...holidays
      .filter((holiday) => holiday.startDate <= addDays(now, HOLIDAY_NOTICE_DAYS))
      .map((holiday) => ({
        kind: "holiday",
        childId: null,
        title: holiday.startDate <= now ? `School closed: ${holiday.title}` : `Holiday: ${holiday.title}`,
        detail: `${formatSpan(holiday.startDate, holiday.endDate)}. No classes or attendance.`,
        at: holiday.startDate,
        href: holidaysHref,
        tone: "info" as const,
      })),
  ];
}

/** What a student would want to be told: absence, homework, results, closures, notices. */
export async function getStudentAlerts(ctx: TenantContext): Promise<FeedAlert[]> {
  assertRole(ctx.user, "STUDENT");
  const self = await findStudentSelf(ctx).catch(() => null);
  if (!self?.placement) return [];
  const now = today();
  const { sectionId, sessionId } = self.placement;

  const [absent, homework, results, exams, shared] = await Promise.all([
    ctx.db.studentAttendance.findFirst({ where: { studentId: self.student.id, date: now, status: "ABSENT" }, select: { id: true } }),
    ctx.db.homework.findMany({
      where: {
        sectionId,
        academicSessionId: sessionId,
        status: "PUBLISHED",
        OR: [{ createdAt: { gte: addDays(now, -2) } }, { dueOn: { gte: now, lte: addDays(now, 1) } }],
        dueOn: { gte: now },
      },
      orderBy: { dueOn: "asc" },
      take: 10,
      select: { id: true, title: true, dueOn: true, createdAt: true, subject: { select: { name: true } } },
    }),
    ctx.db.assessmentResult.findMany({
      where: {
        studentId: self.student.id,
        marksObtained: { not: null },
        assessment: { examId: null, date: { gte: addDays(now, -WINDOW_DAYS) }, ...VISIBLE_PAPER },
      },
      take: 5,
      select: { marksObtained: true, assessment: { select: { name: true, maxMarks: true, date: true, subject: { select: { name: true } } } } },
    }),
    ctx.db.exam.findMany({
      where: { sectionId, academicSessionId: sessionId, status: "PUBLISHED", publishedAt: { gte: addDays(now, -WINDOW_DAYS) } },
      select: { id: true, name: true, publishedAt: true },
    }),
    sharedAlerts(ctx, "/student/notices", "/student/holidays", "/student/meetings"),
  ]);

  const alerts: FeedAlert[] = [...shared, ...(await studentSupportAlerts(ctx, self.student.id))];
  if (absent) {
    alerts.push({ kind: "absent-today", childId: null, title: "You were marked absent today", detail: "If this is wrong, tell your class teacher.", at: now, href: "/student/attendance", tone: "critical" });
  }
  for (const work of homework) {
    const dueSoon = work.dueOn <= addDays(now, 1);
    alerts.push({
      kind: dueSoon ? "homework-due" : "new-homework",
      childId: null,
      title: `${work.subject.name}: ${work.title}`,
      detail: dueSoon ? `Due ${work.dueOn.getTime() === now.getTime() ? "today" : "tomorrow"}.` : `New homework, due ${formatDate(work.dueOn)}.`,
      at: dueSoon ? work.dueOn : work.createdAt,
      href: `/student/homework/${work.id}`,
      tone: dueSoon ? "warning" : "info",
    });
  }
  for (const result of results) {
    alerts.push({
      kind: "new-result",
      childId: null,
      title: `${result.assessment.subject.name}: ${result.assessment.name}`,
      detail: `You scored ${result.marksObtained}/${result.assessment.maxMarks}.`,
      at: result.assessment.date,
      href: "/student/results",
      tone: "info",
    });
  }
  for (const exam of exams) {
    alerts.push({
      kind: "results-published",
      childId: null,
      title: `${exam.name} results are out`,
      detail: "Open your report card on the results page.",
      at: exam.publishedAt ?? now,
      href: "/student/results",
      tone: "info",
    });
  }
  return sortAlerts(alerts);
}

/** What a non-teaching staff member would want to be told: meetings and notices for staff. */
export async function getStaffAlerts(ctx: TenantContext): Promise<FeedAlert[]> {
  assertRole(ctx.user, "NON_TEACHING_STAFF");
  return sortAlerts(await sharedAlerts(ctx, "/staff/notices", null, "/staff/meetings"));
}

/** What a teacher would want to be told: cover duties, leave decisions, marks to enter. */
export async function getTeacherAlerts(ctx: TenantContext): Promise<FeedAlert[]> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const now = today();

  const [covers, leave, assignments, shared] = await Promise.all([
    ctx.db.classSession.findMany({
      where: { actualTeacherId: teacher.id, status: "SUBSTITUTE", date: { gte: now, lte: addDays(now, WINDOW_DAYS) }, NOT: { scheduledTeacherId: teacher.id } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        updatedAt: true,
        scheduledTeacher: { select: { firstName: true, lastName: true } },
        timetableSlot: {
          select: {
            startMinute: true,
            subject: { select: { name: true } },
            section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
          },
        },
      },
    }),
    ctx.db.leaveRequest.findMany({
      where: { teacherId: teacher.id, status: { in: ["APPROVED", "REJECTED"] }, reviewedAt: { gte: addDays(now, -WINDOW_DAYS) } },
      select: { status: true, type: true, startDate: true, endDate: true, reviewNote: true, reviewedAt: true },
    }),
    ctx.db.teacherSubjectAssignment.findMany({
      where: { teacherId: teacher.id, academicSession: { isCurrent: true } },
      select: { sectionId: true, subjectId: true },
    }),
    sharedAlerts(ctx, "/teacher/notices", "/teacher/holidays", "/teacher/meetings"),
  ]);

  const alerts: FeedAlert[] = [...shared, ...(await teacherSupportAlerts(ctx))];
  for (const cover of covers) {
    alerts.push({
      kind: "cover",
      childId: null,
      title: `Cover: ${cover.timetableSlot.subject.name}, ${sectionLabel(cover.timetableSlot.section)}`,
      detail: `${formatDayShort(cover.date)} at ${formatMinutes(cover.timetableSlot.startMinute)}, for ${fullName(cover.scheduledTeacher)}.`,
      at: cover.date,
      href: "/teacher/dashboard",
      tone: cover.date.getTime() === now.getTime() ? "warning" : "info",
    });
  }
  for (const row of leave) {
    alerts.push({
      kind: "leave-decision",
      childId: null,
      title: `${humanize(row.type)} leave ${row.status === "APPROVED" ? "approved" : "not approved"}`,
      detail: `${formatSpan(row.startDate, row.endDate)}${row.reviewNote ? ` — ${row.reviewNote}` : ""}`,
      at: row.reviewedAt ?? now,
      href: "/teacher/leave",
      tone: row.status === "APPROVED" ? "info" : "warning",
    });
  }

  // Exam papers of their subjects, in draft exams, with marks still missing.
  if (assignments.length) {
    const papers = await ctx.db.assessment.findMany({
      where: { exam: { status: "DRAFT" }, date: { lte: now }, OR: assignments.map((row) => ({ sectionId: row.sectionId, subjectId: row.subjectId })) },
      select: {
        id: true,
        name: true,
        sectionId: true,
        date: true,
        subject: { select: { name: true } },
        section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
        _count: { select: { results: { where: { OR: [{ marksObtained: { not: null } }, { absent: true }] } } } },
      },
    });
    const counts = await ctx.db.studentEnrollment.groupBy({
      by: ["sectionId"],
      where: { sectionId: { in: [...new Set(papers.map((paper) => paper.sectionId))] }, academicSession: { isCurrent: true }, status: "ACTIVE", student: { status: "ACTIVE" } },
      _count: { _all: true },
    });
    const studentsIn = new Map(counts.map((row) => [row.sectionId, row._count._all]));
    for (const paper of papers) {
      const missing = (studentsIn.get(paper.sectionId) ?? 0) - paper._count.results;
      if (missing <= 0) continue;
      alerts.push({
        kind: "marks-due",
        childId: null,
        title: `Marks to enter: ${paper.subject.name}, ${paper.name}`,
        detail: `${sectionLabel(paper.section)} — ${missing} still missing.`,
        at: paper.date,
        href: `/teacher/exams/${paper.id}`,
        tone: "warning",
      });
    }
  }
  return sortAlerts(alerts);
}
