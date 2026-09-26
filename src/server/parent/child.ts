import "server-only";

import { addDays, dayOfWeek, today, toDateInput } from "@/lib/dates";
import { fullName } from "@/lib/format";
import type { TenantContext } from "@/server/auth/current-user";
import { type AttendanceCounts, attendedShare, emptyCounts } from "@/server/attendance/service";
import { monthlyAttendance } from "@/server/analytics/student";
import { readStudentFees } from "@/server/finance/fees";
import { type ChildContext, requireChild } from "@/server/parent/access";

/**
 * What a guardian can read about one child.
 *
 * Every function here reads the same operational rows the school already
 * works from — the register a teacher took, the period they wrote up, the
 * homework they set, the marks they entered. Nothing is copied into a
 * parent-shaped table, so a parent's screen cannot drift from the register.
 *
 * Each one re-resolves the child through `requireChild`, so authorization does
 * not depend on the caller having done it first. That costs one small query per
 * read and removes an entire class of mistake.
 */

/** Below this share of attended days, the child's attendance is called out. */
export const LOW_ATTENDANCE_THRESHOLD = 0.75;

/** How far back the attendance trend and the activity feed look by default. */
const HISTORY_DAYS = 30;

// -----------------------------------------------------------------------------
// Today
// -----------------------------------------------------------------------------

/**
 * "What happened at school today?" — the question the portal exists to answer.
 *
 * Period-by-period, as the teachers recorded it: a period with no
 * `ClassSession` row has simply not been written up yet, which is different
 * from one recorded as missed.
 */
export async function getChildToday(ctx: TenantContext, studentId: string, date: Date = today()) {
  const child = await requireChild(ctx, studentId);
  const { placement } = child;

  const [attendance, slots, recorded, homework, latestResult, latestRemark] = await Promise.all([
    ctx.db.studentAttendance.findFirst({
      where: { studentId, date },
      select: { status: true, remarks: true },
    }),
    ctx.db.timetableSlot.findMany({
      where: {
        sectionId: placement.sectionId,
        academicSessionId: placement.sessionId,
        dayOfWeek: dayOfWeek(date),
      },
      orderBy: { startMinute: "asc" },
      select: {
        id: true,
        startMinute: true,
        endMinute: true,
        room: true,
        subject: { select: { name: true } },
        teacher: { select: { firstName: true, lastName: true } },
      },
    }),
    ctx.db.classSession.findMany({
      where: { date, timetableSlot: { sectionId: placement.sectionId } },
      select: {
        timetableSlotId: true,
        status: true,
        topic: true,
        notes: true,
        actualTeacher: { select: { firstName: true, lastName: true } },
      },
    }),
    ctx.db.homework.findMany({
      where: {
        sectionId: placement.sectionId,
        status: "PUBLISHED",
        dueOn: { gte: date },
      },
      orderBy: { dueOn: "asc" },
      take: 5,
      select: {
        id: true,
        title: true,
        dueOn: true,
        subject: { select: { name: true } },
      },
    }),
    ctx.db.assessmentResult.findFirst({
      where: { studentId, marksObtained: { not: null } },
      orderBy: { assessment: { date: "desc" } },
      select: {
        marksObtained: true,
        assessment: {
          select: { name: true, date: true, maxMarks: true, subject: { select: { name: true } } },
        },
      },
    }),
    ctx.db.studentRemark.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      select: {
        understanding: true,
        homeworkHabit: true,
        participation: true,
        body: true,
        createdAt: true,
        teacher: { select: { firstName: true, lastName: true } },
        subject: { select: { name: true } },
      },
    }),
  ]);

  const bySlot = new Map(recorded.map((row) => [row.timetableSlotId, row]));
  const periods = slots.map((slot) => {
    const session = bySlot.get(slot.id) ?? null;
    return {
      slotId: slot.id,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      room: slot.room,
      subject: slot.subject.name,
      scheduledTeacher: fullName(slot.teacher),
      /** Null means "not written up yet", which is not the same as MISSED. */
      status: session?.status ?? null,
      topic: session?.topic ?? null,
      notes: session?.notes ?? null,
      takenBy: session?.actualTeacher ? fullName(session.actualTeacher) : null,
    };
  });

  const tally = {
    scheduled: periods.length,
    completed: periods.filter((p) => p.status === "COMPLETED" || p.status === "REMOTE").length,
    substitute: periods.filter((p) => p.status === "SUBSTITUTE").length,
    missed: periods.filter((p) => p.status === "MISSED").length,
    cancelled: periods.filter((p) => p.status === "CANCELLED").length,
    notRecorded: periods.filter((p) => p.status === null).length,
  };

  return {
    child,
    date,
    attendance,
    periods,
    tally,
    homework,
    latestResult: latestResult?.assessment
      ? {
          name: latestResult.assessment.name,
          subject: latestResult.assessment.subject.name,
          date: latestResult.assessment.date,
          marksObtained: latestResult.marksObtained,
          maxMarks: latestResult.assessment.maxMarks,
        }
      : null,
    latestRemark: latestRemark
      ? {
          understanding: latestRemark.understanding,
          homeworkHabit: latestRemark.homeworkHabit,
          participation: latestRemark.participation,
          note: latestRemark.body,
          createdAt: latestRemark.createdAt,
          author: fullName(latestRemark.teacher),
          subject: latestRemark.subject?.name ?? null,
        }
      : null,
  };
}

// -----------------------------------------------------------------------------
// Attendance
// -----------------------------------------------------------------------------

/**
 * The child's own register, for the whole current session.
 *
 * Read-only by design: there is no guardian-facing writer anywhere in this
 * module, and `markAttendance` asserts TEACHER or SCHOOL_ADMIN, so a forged
 * request has nothing to reach.
 */
export async function getChildAttendance(ctx: TenantContext, studentId: string) {
  const child = await requireChild(ctx, studentId);

  const rows = await ctx.db.studentAttendance.findMany({
    where: { studentId, academicSessionId: child.placement.sessionId },
    orderBy: { date: "desc" },
    select: { id: true, date: true, status: true, remarks: true },
  });

  const counts = emptyCounts();
  for (const row of rows) {
    counts[row.status] += 1;
    counts.total += 1;
  }

  const share = attendedShare(counts);
  const now = today();
  const from = addDays(now, -HISTORY_DAYS);

  // A day with no mark is a gap, not a zero: schools do not take a register on
  // a holiday, and drawing it as 0% would read as a day everybody missed.
  const trend = rows
    .filter((row) => row.date >= from)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((row) => ({ date: row.date, status: row.status }));

  return {
    child,
    counts,
    share,
    rows,
    trend,
    months: monthlyAttendance(rows.map((row) => ({ date: row.date, status: row.status }))),
    low: share !== null && share < LOW_ATTENDANCE_THRESHOLD,
    threshold: LOW_ATTENDANCE_THRESHOLD,
  };
}

// -----------------------------------------------------------------------------
// Timetable
// -----------------------------------------------------------------------------

/** The weekly periods of the section the school has placed this child in. */
export async function getChildTimetable(ctx: TenantContext, studentId: string) {
  const child = await requireChild(ctx, studentId);

  const slots = await ctx.db.timetableSlot.findMany({
    where: {
      sectionId: child.placement.sectionId,
      academicSessionId: child.placement.sessionId,
    },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    select: {
      id: true,
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
      room: true,
      subject: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
  });

  return { child, slots };
}

// -----------------------------------------------------------------------------
// Class activity
// -----------------------------------------------------------------------------

/**
 * What was actually taught, newest first.
 *
 * The teacher's own write-up of each period: the topic, any note, and whether
 * the class happened as scheduled, was taken by a substitute, or was missed.
 */
export async function getChildActivity(
  ctx: TenantContext,
  studentId: string,
  options: { days?: number; subjectId?: string | null } = {},
) {
  const child = await requireChild(ctx, studentId);
  const from = addDays(today(), -(options.days ?? HISTORY_DAYS));

  const rows = await ctx.db.classSession.findMany({
    where: {
      date: { gte: from },
      timetableSlot: {
        sectionId: child.placement.sectionId,
        academicSessionId: child.placement.sessionId,
        ...(options.subjectId ? { subjectId: options.subjectId } : {}),
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      date: true,
      status: true,
      topic: true,
      notes: true,
      timetableSlot: {
        select: {
          startMinute: true,
          endMinute: true,
          subject: { select: { id: true, name: true } },
        },
      },
      scheduledTeacher: { select: { firstName: true, lastName: true } },
      actualTeacher: { select: { firstName: true, lastName: true } },
    },
  });

  // The subjects this child is actually taught, for the filter.
  const subjects = await ctx.db.timetableSlot.findMany({
    where: {
      sectionId: child.placement.sectionId,
      academicSessionId: child.placement.sessionId,
    },
    distinct: ["subjectId"],
    orderBy: { subject: { name: "asc" } },
    select: { subject: { select: { id: true, name: true } } },
  });

  return {
    child,
    subjects: subjects.map((row) => row.subject),
    entries: rows.map((row) => ({
      id: row.id,
      date: row.date,
      startMinute: row.timetableSlot.startMinute,
      endMinute: row.timetableSlot.endMinute,
      subject: row.timetableSlot.subject.name,
      subjectId: row.timetableSlot.subject.id,
      status: row.status,
      topic: row.topic,
      notes: row.notes,
      teacher: fullName(row.actualTeacher ?? row.scheduledTeacher),
      // Named only when somebody stood in, so the usual case stays quiet.
      stoodInFor:
        row.status === "SUBSTITUTE" && row.actualTeacher
          ? fullName(row.scheduledTeacher)
          : null,
    })),
  };
}

// -----------------------------------------------------------------------------
// Homework
// -----------------------------------------------------------------------------

export type HomeworkBucket = "overdue" | "dueToday" | "dueSoon" | "upcoming" | "past";

/**
 * Work set for this child's section, bucketed by what a parent needs to do
 * about it tonight.
 *
 * Only `PUBLISHED` rows: a teacher's draft is not work the class has been set,
 * and showing it would have a parent chasing homework that does not exist yet.
 * There is no completion tracking in the schema, so nothing here claims to know
 * whether the child has done it.
 */
export async function getChildHomework(ctx: TenantContext, studentId: string) {
  const child = await requireChild(ctx, studentId);
  const now = today();

  const rows = await ctx.db.homework.findMany({
    where: {
      sectionId: child.placement.sectionId,
      academicSessionId: child.placement.sessionId,
      status: "PUBLISHED",
    },
    orderBy: { dueOn: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      description: true,
      assignedOn: true,
      dueOn: true,
      subject: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
  });

  const soonCutoff = addDays(now, 3);

  const entries = rows.map((row) => {
    const bucket: HomeworkBucket =
      row.dueOn < now
        ? "overdue"
        : row.dueOn.getTime() === now.getTime()
          ? "dueToday"
          : row.dueOn <= soonCutoff
            ? "dueSoon"
            : "upcoming";
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      assignedOn: row.assignedOn,
      dueOn: row.dueOn,
      subject: row.subject.name,
      teacher: fullName(row.teacher),
      bucket,
    };
  });

  return {
    child,
    // Anything already past its due date is history once it is a week old; the
    // rest stays in "overdue" so a parent still sees what was missed.
    overdue: entries.filter((e) => e.bucket === "overdue" && e.dueOn >= addDays(now, -14)),
    dueToday: entries.filter((e) => e.bucket === "dueToday"),
    dueSoon: entries.filter((e) => e.bucket === "dueSoon"),
    upcoming: entries.filter((e) => e.bucket === "upcoming"),
    past: entries.filter((e) => e.bucket === "overdue" && e.dueOn < addDays(now, -14)),
  };
}

// -----------------------------------------------------------------------------
// Tests and marks
// -----------------------------------------------------------------------------

/**
 * Every assessment this child's section has sat, with their own mark.
 *
 * A null mark means the child did not sit it, which is deliberately distinct
 * from a zero. Percentages are computed here rather than stored, so correcting
 * a paper's total corrects every figure that depends on it.
 */
export async function getChildResults(ctx: TenantContext, studentId: string) {
  const child = await requireChild(ctx, studentId);

  const assessments = await ctx.db.assessment.findMany({
    where: {
      sectionId: child.placement.sectionId,
      academicSessionId: child.placement.sessionId,
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      name: true,
      date: true,
      maxMarks: true,
      subject: { select: { id: true, name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      results: {
        where: { studentId },
        select: { marksObtained: true, remarks: true },
      },
    },
  });

  const entries = assessments.map((row) => {
    const result = row.results[0] ?? null;
    const marks = result?.marksObtained ?? null;
    return {
      id: row.id,
      name: row.name,
      date: row.date,
      subject: row.subject.name,
      subjectId: row.subject.id,
      maxMarks: row.maxMarks,
      marksObtained: marks,
      /** Null when the child did not sit it — not zero. */
      share: marks === null || row.maxMarks === 0 ? null : marks / row.maxMarks,
      note: result?.remarks ?? null,
      teacher: row.teacher ? fullName(row.teacher) : null,
      sat: result !== null && marks !== null,
    };
  });

  // Subject-wise, oldest first, so a trend reads left to right.
  const bySubject = new Map<string, { subject: string; points: typeof entries }>();
  for (const entry of [...entries].reverse()) {
    if (!entry.sat) continue;
    const group = bySubject.get(entry.subjectId) ?? { subject: entry.subject, points: [] };
    group.points.push(entry);
    bySubject.set(entry.subjectId, group);
  }

  const subjects = [...bySubject.values()].map((group) => {
    const shares = group.points.map((p) => p.share!).filter((s) => s !== null);
    const average = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
    const first = shares[0];
    const last = shares[shares.length - 1];
    return {
      subject: group.subject,
      points: group.points,
      average,
      // A single result is a point, not a direction. Only claim a trend once
      // there are two to compare.
      direction:
        shares.length < 2 || first === undefined || last === undefined
          ? null
          : last > first + 0.02
            ? ("up" as const)
            : last < first - 0.02
              ? ("down" as const)
              : ("flat" as const),
    };
  });

  const sat = entries.filter((entry) => entry.sat);
  const overall = sat.length
    ? sat.reduce((sum, entry) => sum + (entry.share ?? 0), 0) / sat.length
    : null;

  return { child, entries, subjects, overall, satCount: sat.length };
}

// -----------------------------------------------------------------------------
// Teacher remarks
// -----------------------------------------------------------------------------

/** Structured observations about this child, from any of their teachers. */
export async function getChildRemarks(ctx: TenantContext, studentId: string) {
  const child = await requireChild(ctx, studentId);

  const rows = await ctx.db.studentRemark.findMany({
    where: { studentId, academicSessionId: child.placement.sessionId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      understanding: true,
      homeworkHabit: true,
      participation: true,
      body: true,
      createdAt: true,
      teacher: { select: { firstName: true, lastName: true } },
      subject: { select: { name: true } },
    },
  });

  return {
    child,
    entries: rows.map((row) => ({
      id: row.id,
      understanding: row.understanding,
      homeworkHabit: row.homeworkHabit,
      participation: row.participation,
      note: row.body,
      createdAt: row.createdAt,
      author: fullName(row.teacher),
      subject: row.subject?.name ?? null,
    })),
  };
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------

export const REPORT_PERIODS = ["day", "week", "month"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

const PERIOD_DAYS: Record<ReportPeriod, number> = { day: 1, week: 7, month: 30 };

/**
 * A summary assembled from source data, not a document anybody had to write.
 *
 * This is the point of keeping one copy of the operational records: the same
 * registers, lesson records, homework, marks and remarks that the school runs
 * on are summed here. No teacher fills in a "daily report" for a parent, and
 * nothing can disagree with the register because nothing was copied.
 */
export async function getChildReport(
  ctx: TenantContext,
  studentId: string,
  period: ReportPeriod = "week",
) {
  const child = await requireChild(ctx, studentId);
  const to = today();
  const from = addDays(to, -(PERIOD_DAYS[period] - 1));

  const [attendance, lessons, homework, results, remarks] = await Promise.all([
    ctx.db.studentAttendance.findMany({
      where: { studentId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      select: { date: true, status: true, remarks: true },
    }),
    ctx.db.classSession.findMany({
      where: {
        date: { gte: from, lte: to },
        timetableSlot: { sectionId: child.placement.sectionId },
      },
      orderBy: [{ date: "asc" }],
      select: {
        id: true,
        date: true,
        status: true,
        topic: true,
        timetableSlot: { select: { subject: { select: { name: true } } } },
      },
    }),
    ctx.db.homework.findMany({
      where: {
        sectionId: child.placement.sectionId,
        status: "PUBLISHED",
        assignedOn: { gte: from, lte: to },
      },
      orderBy: { dueOn: "asc" },
      select: {
        id: true,
        title: true,
        dueOn: true,
        subject: { select: { name: true } },
      },
    }),
    ctx.db.assessmentResult.findMany({
      where: { studentId, assessment: { date: { gte: from, lte: to } } },
      orderBy: { assessment: { date: "asc" } },
      select: {
        marksObtained: true,
        assessment: {
          select: { id: true, name: true, date: true, maxMarks: true, subject: { select: { name: true } } },
        },
      },
    }),
    ctx.db.studentRemark.findMany({
      where: { studentId, createdAt: { gte: from } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        understanding: true,
        homeworkHabit: true,
        participation: true,
        body: true,
        createdAt: true,
        teacher: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const counts = emptyCounts();
  for (const row of attendance) {
    counts[row.status] += 1;
    counts.total += 1;
  }

  const bySubject = new Map<string, { subject: string; topics: string[]; periods: number }>();
  for (const lesson of lessons) {
    const name = lesson.timetableSlot.subject.name;
    const entry = bySubject.get(name) ?? { subject: name, topics: [], periods: 0 };
    entry.periods += 1;
    if (lesson.topic && !entry.topics.includes(lesson.topic)) entry.topics.push(lesson.topic);
    bySubject.set(name, entry);
  }

  return {
    child,
    period,
    from,
    to,
    attendance: { rows: attendance, counts, share: attendedShare(counts) },
    lessons: {
      total: lessons.length,
      completed: lessons.filter((l) => l.status === "COMPLETED" || l.status === "REMOTE").length,
      substitute: lessons.filter((l) => l.status === "SUBSTITUTE").length,
      missed: lessons.filter((l) => l.status === "MISSED").length,
      bySubject: [...bySubject.values()].sort((a, b) => a.subject.localeCompare(b.subject)),
    },
    homework,
    results: results.map((row) => ({
      id: row.assessment.id,
      name: row.assessment.name,
      subject: row.assessment.subject.name,
      date: row.assessment.date,
      marksObtained: row.marksObtained,
      maxMarks: row.assessment.maxMarks,
      share:
        row.marksObtained === null || row.assessment.maxMarks === 0
          ? null
          : row.marksObtained / row.assessment.maxMarks,
    })),
    remarks: remarks.map((row) => ({
      id: row.id,
      understanding: row.understanding,
      homeworkHabit: row.homeworkHabit,
      participation: row.participation,
      note: row.body,
      createdAt: row.createdAt,
      author: fullName(row.teacher),
    })),
  };
}

// -----------------------------------------------------------------------------
// Fees
// -----------------------------------------------------------------------------

/**
 * One child's fee account: the breakdown, the receipts and the four numbers.
 *
 * Reads the same `FeeCharge` and `FeePayment` rows the office works from, and
 * the same `summarise` arithmetic the collection screen uses — so a parent
 * reading "₹10,000 pending" is reading exactly what the school sees. There is no
 * parent-only copy of a fee record anywhere.
 *
 * Read-only. Every writer in `server/finance/fees.ts` asserts SCHOOL_ADMIN, so
 * there is nothing here a forged request could reach, and no online payment is
 * pretended at.
 */
export async function getChildFees(ctx: TenantContext, studentId: string) {
  // The guardian link is checked before a single fee row is touched.
  const child = await requireChild(ctx, studentId);
  const account = await readStudentFees(ctx, studentId, child.placement.sessionId);
  return { child, ...account };
}

// -----------------------------------------------------------------------------
// Home preparation
// -----------------------------------------------------------------------------

export type FocusReason =
  | "recent-topic"
  | "weak-subject"
  | "homework-due"
  | "attendance"
  | "missed-class";

export type FocusItem = {
  reason: FocusReason;
  subject: string | null;
  headline: string;
  detail: string;
};

/**
 * What to help with at home, derived only from what the school recorded.
 *
 * Deliberately deterministic. Every line below points at a specific row a
 * teacher wrote — a topic taught, a mark entered, a due date set — and says so,
 * so a parent can check it against the rest of the portal. There is no model
 * here and no advice invented from nothing: the school stays the authority on
 * what the child should be doing, and this only arranges what it already said.
 *
 * The shape is the foundation the future "Home Preparation" feature needs: if
 * suggestions ever get richer, they replace the bodies of these rules and the
 * screen does not change.
 */
export async function getChildFocus(
  ctx: TenantContext,
  studentId: string,
): Promise<{ child: ChildContext; items: FocusItem[] }> {
  const child = await requireChild(ctx, studentId);
  const [activity, results, homework, attendance] = await Promise.all([
    getChildActivity(ctx, studentId, { days: 7 }),
    getChildResults(ctx, studentId),
    getChildHomework(ctx, studentId),
    getChildAttendance(ctx, studentId),
  ]);

  const items: FocusItem[] = [];

  // 1. Whatever is due first is the most actionable thing tonight.
  const nextDue = [...homework.overdue, ...homework.dueToday, ...homework.dueSoon][0];
  if (nextDue) {
    items.push({
      reason: "homework-due",
      subject: nextDue.subject,
      headline: `${nextDue.subject}: ${nextDue.title}`,
      detail:
        nextDue.bucket === "overdue"
          ? `Was due ${toDateInput(nextDue.dueOn)} and is still on the list. Worth asking about tonight.`
          : `Due ${toDateInput(nextDue.dueOn)}. Set by ${nextDue.teacher}.`,
    });
  }

  // 2. The weakest subject with enough marks to mean something.
  const weakest = results.subjects
    .filter((s) => s.average !== null && s.points.length >= 2)
    .sort((a, b) => (a.average ?? 1) - (b.average ?? 1))[0];
  if (weakest && (weakest.average ?? 1) < 0.7) {
    items.push({
      reason: "weak-subject",
      subject: weakest.subject,
      headline: `${weakest.subject} is the lowest so far`,
      detail: `Averaging ${Math.round((weakest.average ?? 0) * 100)}% across ${weakest.points.length} tests. Reviewing the mistakes in the last paper is usually the quickest win.`,
    });
  }

  // 3. The topic most recently taught, so revision follows the class.
  const lastTopic = activity.entries.find((entry) => entry.topic && entry.status !== "CANCELLED");
  if (lastTopic?.topic) {
    items.push({
      reason: "recent-topic",
      subject: lastTopic.subject,
      headline: `Currently on: ${lastTopic.topic}`,
      detail: `Taught in ${lastTopic.subject} on ${toDateInput(lastTopic.date)} by ${lastTopic.teacher}. Going over it at home while it is fresh helps more than revising it later.`,
    });
  }

  // 4. A missed class is a gap the child did not choose.
  const missed = activity.entries.find((entry) => entry.status === "MISSED");
  if (missed) {
    items.push({
      reason: "missed-class",
      subject: missed.subject,
      headline: `A ${missed.subject} class was missed`,
      detail: `On ${toDateInput(missed.date)}. Worth checking whether the class has caught up on it since.`,
    });
  }

  // 5. Attendance, last, because it is a pattern rather than a task.
  if (attendance.low && attendance.share !== null) {
    items.push({
      reason: "attendance",
      subject: null,
      headline: `Attendance is ${Math.round(attendance.share * 100)}%`,
      detail: `Below the ${Math.round(LOW_ATTENDANCE_THRESHOLD * 100)}% the school looks for. ${attendance.counts.ABSENT} days absent this session.`,
    });
  }

  return { child, items };
}

export type { AttendanceCounts };
