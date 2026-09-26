import "server-only";

import { addDays, dayOfWeek, today } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { monthlyAttendance } from "@/server/analytics/student";
import { readStudentFees } from "@/server/finance/fees";
import { type AttendanceCounts, attendedShare, emptyCounts } from "@/server/attendance/service";
import type { TenantContext } from "@/server/auth/current-user";
import { type StudentContext, requireStudentSelf } from "@/server/student/access";

/**
 * What a student can read about their own school life.
 *
 * Every function re-resolves the signed-in student through `requireStudentSelf`,
 * so authorization is inside each read rather than assumed of the caller, and
 * none of them accepts a student id at all. The only id any of them takes is a
 * `classSessionId` — and that is checked against the student's own section
 * before a word of it is returned.
 *
 * Like the parent portal, this reads the operational rows the school already
 * works from. There is no student-shaped copy of the register, the timetable,
 * the homework or the marks.
 */

/** Below this share of attended days, attendance is called out. */
export const LOW_ATTENDANCE_THRESHOLD = 0.75;

const RECENT_DAYS = 30;

const MATERIAL_SELECT = {
  id: true,
  kind: true,
  title: true,
  url: true,
  body: true,
} as const;

// -----------------------------------------------------------------------------
// Today
// -----------------------------------------------------------------------------

/**
 * "What classes do I have today, and which are done?"
 *
 * A period with a `ClassSession` row has been written up; one without has not.
 * Whether an un-written-up period is still ahead is decided by the clock, not
 * guessed: a 9am lesson with no record at 3pm is late, not upcoming.
 */
export async function getMyDay(ctx: TenantContext, date: Date = today()) {
  const me = await requireStudentSelf(ctx);
  const { placement } = me;

  const [slots, recorded, attendance] = await Promise.all([
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
        subject: { select: { id: true, name: true } },
        teacher: { select: { firstName: true, lastName: true } },
      },
    }),
    ctx.db.classSession.findMany({
      where: { date, timetableSlot: { sectionId: placement.sectionId } },
      select: {
        id: true,
        timetableSlotId: true,
        status: true,
        topic: true,
        plannedTopic: true,
        preparation: true,
        importantPoints: true,
        notes: true,
        actualTeacher: { select: { firstName: true, lastName: true } },
        _count: { select: { materials: true } },
      },
    }),
    ctx.db.studentAttendance.findFirst({
      where: { studentId: me.student.id, date },
      select: { status: true, remarks: true },
    }),
  ]);

  const bySlot = new Map(recorded.map((row) => [row.timetableSlotId, row]));

  // Minutes since midnight in the school's own timezone, so "already finished"
  // means finished where the school is, not where the server is.
  const nowMinutes = schoolClockMinutes();
  const isToday = date.getTime() === today().getTime();

  const periods = slots.map((slot) => {
    const lesson = bySlot.get(slot.id) ?? null;
    const written = lesson !== null && lesson.status !== "SCHEDULED";
    return {
      slotId: slot.id,
      lessonId: lesson?.id ?? null,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      room: slot.room,
      subject: slot.subject.name,
      subjectId: slot.subject.id,
      teacher: lesson?.actualTeacher ? fullName(lesson.actualTeacher) : fullName(slot.teacher),
      status: lesson?.status ?? null,
      /** What was taught, or failing that what the teacher planned to teach. */
      topic: lesson?.topic ?? lesson?.plannedTopic ?? null,
      preparation: lesson?.preparation ?? null,
      importantPoints: lesson?.importantPoints ?? null,
      hasNotes: Boolean(lesson?.notes),
      materialCount: lesson?._count.materials ?? 0,
      written,
      /** Still ahead on the clock, and only meaningful for today itself. */
      upcoming: !written && (!isToday || slot.startMinute > nowMinutes),
    };
  });

  return {
    me,
    date,
    attendance,
    periods,
    tally: {
      scheduled: periods.length,
      completed: periods.filter((p) => p.status === "COMPLETED" || p.status === "REMOTE").length,
      substitute: periods.filter((p) => p.status === "SUBSTITUTE").length,
      missed: periods.filter((p) => p.status === "MISSED" || p.status === "CANCELLED").length,
      upcoming: periods.filter((p) => p.upcoming).length,
    },
    /** The next period still to come, which is what a student looks for first. */
    next: periods.find((period) => period.upcoming) ?? null,
  };
}

/** Wall-clock minutes since midnight where the school is. */
function schoolClockMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(now);
  const [hour, minute] = parts.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

// -----------------------------------------------------------------------------
// Lessons — completed and upcoming
// -----------------------------------------------------------------------------

/**
 * Lessons already taught, newest first, for revision.
 *
 * Only rows a teacher has actually written up: a `SCHEDULED` row is a plan, not
 * a record of a class that happened.
 */
export async function getMyCompletedLessons(
  ctx: TenantContext,
  options: { days?: number; subjectId?: string | null } = {},
) {
  const me = await requireStudentSelf(ctx);
  const from = addDays(today(), -(options.days ?? RECENT_DAYS));

  const rows = await ctx.db.classSession.findMany({
    where: {
      date: { gte: from, lte: today() },
      status: { not: "SCHEDULED" },
      timetableSlot: {
        sectionId: me.placement.sectionId,
        academicSessionId: me.placement.sessionId,
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
      importantPoints: true,
      timetableSlot: {
        select: {
          startMinute: true,
          endMinute: true,
          subject: { select: { id: true, name: true } },
        },
      },
      scheduledTeacher: { select: { firstName: true, lastName: true } },
      actualTeacher: { select: { firstName: true, lastName: true } },
      _count: { select: { materials: true } },
    },
  });

  return {
    me,
    subjects: await mySubjects(ctx, me),
    lessons: rows.map((row) => ({
      id: row.id,
      date: row.date,
      startMinute: row.timetableSlot.startMinute,
      subject: row.timetableSlot.subject.name,
      subjectId: row.timetableSlot.subject.id,
      status: row.status,
      topic: row.topic,
      teacher: fullName(row.actualTeacher ?? row.scheduledTeacher),
      hasNotes: Boolean(row.notes),
      hasImportantPoints: Boolean(row.importantPoints),
      materialCount: row._count.materials,
    })),
  };
}

/**
 * Lessons the teacher has planned but not yet taught.
 *
 * A planned lesson is the same `ClassSession` row in its `SCHEDULED` state with
 * a `plannedTopic` on it — which is why nothing here invents a topic. A period
 * the teacher has not planned simply does not appear.
 */
export async function getMyUpcomingLessons(ctx: TenantContext, options: { days?: number } = {}) {
  const me = await requireStudentSelf(ctx);
  const now = today();
  const to = addDays(now, options.days ?? 14);

  const rows = await ctx.db.classSession.findMany({
    where: {
      date: { gte: now, lte: to },
      status: "SCHEDULED",
      // Announced without a topic or a preparation note is not worth a row on a
      // student's screen, so only planned lessons are listed.
      OR: [{ plannedTopic: { not: null } }, { preparation: { not: null } }],
      timetableSlot: {
        sectionId: me.placement.sectionId,
        academicSessionId: me.placement.sessionId,
      },
    },
    orderBy: [{ date: "asc" }],
    take: 50,
    select: {
      id: true,
      date: true,
      plannedTopic: true,
      preparation: true,
      timetableSlot: {
        select: {
          startMinute: true,
          subject: { select: { id: true, name: true } },
        },
      },
      scheduledTeacher: { select: { firstName: true, lastName: true } },
      _count: { select: { materials: true } },
    },
  });

  return {
    me,
    lessons: rows.map((row) => ({
      id: row.id,
      date: row.date,
      startMinute: row.timetableSlot.startMinute,
      subject: row.timetableSlot.subject.name,
      subjectId: row.timetableSlot.subject.id,
      plannedTopic: row.plannedTopic,
      preparation: row.preparation,
      teacher: fullName(row.scheduledTeacher),
      materialCount: row._count.materials,
    })),
  };
}

/**
 * One lesson in full — what was taught, the notes, the points to revise, the
 * material and the homework set around it.
 *
 * The `classSessionId` is the only id a student read accepts, and it is checked
 * against their own section here: a lesson belonging to another section, or to
 * another school, answers exactly as one that does not exist.
 */
export async function getMyLesson(ctx: TenantContext, classSessionId: string) {
  const me = await requireStudentSelf(ctx);

  const lesson = await ctx.db.classSession.findFirst({
    where: {
      id: classSessionId,
      // The check that matters: this lesson must belong to the student's own
      // section in the current session.
      timetableSlot: {
        sectionId: me.placement.sectionId,
        academicSessionId: me.placement.sessionId,
      },
    },
    select: {
      id: true,
      date: true,
      status: true,
      topic: true,
      plannedTopic: true,
      notes: true,
      importantPoints: true,
      preparation: true,
      timetableSlot: {
        select: {
          startMinute: true,
          endMinute: true,
          room: true,
          subject: { select: { id: true, name: true } },
        },
      },
      scheduledTeacher: { select: { firstName: true, lastName: true } },
      actualTeacher: { select: { firstName: true, lastName: true } },
      materials: { orderBy: { createdAt: "asc" }, select: MATERIAL_SELECT },
    },
  });

  if (!lesson) throw new NotFoundError("That lesson was not found.");

  // Homework in the same subject set around the lesson, which is what a student
  // is actually looking for when they open it.
  const homework = await ctx.db.homework.findMany({
    where: {
      sectionId: me.placement.sectionId,
      subjectId: lesson.timetableSlot.subject.id,
      status: "PUBLISHED",
      assignedOn: { gte: addDays(lesson.date, -1), lte: addDays(lesson.date, 2) },
    },
    orderBy: { dueOn: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      assignedOn: true,
      dueOn: true,
      teacher: { select: { firstName: true, lastName: true } },
    },
  });

  return {
    me,
    lesson: {
      id: lesson.id,
      date: lesson.date,
      startMinute: lesson.timetableSlot.startMinute,
      endMinute: lesson.timetableSlot.endMinute,
      room: lesson.timetableSlot.room,
      subject: lesson.timetableSlot.subject.name,
      status: lesson.status,
      topic: lesson.topic ?? lesson.plannedTopic,
      taught: lesson.status !== "SCHEDULED",
      notes: lesson.notes,
      importantPoints: lesson.importantPoints,
      preparation: lesson.preparation,
      teacher: fullName(lesson.actualTeacher ?? lesson.scheduledTeacher),
      stoodInFor:
        lesson.status === "SUBSTITUTE" && lesson.actualTeacher
          ? fullName(lesson.scheduledTeacher)
          : null,
      materials: lesson.materials,
    },
    homework: homework.map((row) => ({ ...row, teacher: fullName(row.teacher) })),
  };
}

/** Every material attached to any of this student's own lessons. */
export async function getMyMaterials(
  ctx: TenantContext,
  options: { subjectId?: string | null } = {},
) {
  const me = await requireStudentSelf(ctx);

  const rows = await ctx.db.lessonMaterial.findMany({
    where: {
      classSession: {
        timetableSlot: {
          sectionId: me.placement.sectionId,
          academicSessionId: me.placement.sessionId,
          ...(options.subjectId ? { subjectId: options.subjectId } : {}),
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      ...MATERIAL_SELECT,
      createdAt: true,
      classSession: {
        select: {
          id: true,
          date: true,
          topic: true,
          plannedTopic: true,
          timetableSlot: { select: { subject: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  return {
    me,
    subjects: await mySubjects(ctx, me),
    materials: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      url: row.url,
      body: row.body,
      createdAt: row.createdAt,
      lessonId: row.classSession.id,
      lessonDate: row.classSession.date,
      lessonTopic: row.classSession.topic ?? row.classSession.plannedTopic,
      subject: row.classSession.timetableSlot.subject.name,
      subjectId: row.classSession.timetableSlot.subject.id,
    })),
  };
}

// -----------------------------------------------------------------------------
// Homework, timetable, attendance, results, remarks
// -----------------------------------------------------------------------------

/**
 * Work set for this student's section, bucketed by urgency.
 *
 * There is no submission or completion tracking in the schema, so nothing here
 * claims to know whether the student has done it. Adding that would be a new
 * feature, not a display change.
 */
export async function getMyHomework(ctx: TenantContext) {
  const me = await requireStudentSelf(ctx);
  const now = today();

  const rows = await ctx.db.homework.findMany({
    where: {
      sectionId: me.placement.sectionId,
      academicSessionId: me.placement.sessionId,
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
      subject: { select: { id: true, name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
  });

  const soon = addDays(now, 3);
  const entries = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    assignedOn: row.assignedOn,
    dueOn: row.dueOn,
    subject: row.subject.name,
    subjectId: row.subject.id,
    teacher: fullName(row.teacher),
  }));

  return {
    me,
    overdue: entries.filter((e) => e.dueOn < now && e.dueOn >= addDays(now, -14)),
    dueToday: entries.filter((e) => e.dueOn.getTime() === now.getTime()),
    dueSoon: entries.filter((e) => e.dueOn > now && e.dueOn <= soon),
    upcoming: entries.filter((e) => e.dueOn > soon),
    past: entries.filter((e) => e.dueOn < addDays(now, -14)),
  };
}

export async function getMyTimetable(ctx: TenantContext) {
  const me = await requireStudentSelf(ctx);

  const slots = await ctx.db.timetableSlot.findMany({
    where: {
      sectionId: me.placement.sectionId,
      academicSessionId: me.placement.sessionId,
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

  return { me, slots };
}

/** The student's own register. Read-only — nothing here writes. */
export async function getMyAttendance(ctx: TenantContext) {
  const me = await requireStudentSelf(ctx);

  const rows = await ctx.db.studentAttendance.findMany({
    where: { studentId: me.student.id, academicSessionId: me.placement.sessionId },
    orderBy: { date: "desc" },
    select: { id: true, date: true, status: true, remarks: true },
  });

  const counts = emptyCounts();
  for (const row of rows) {
    counts[row.status] += 1;
    counts.total += 1;
  }
  const share = attendedShare(counts);

  return {
    me,
    counts,
    share,
    rows,
    months: monthlyAttendance(rows.map((row) => ({ date: row.date, status: row.status }))),
    low: share !== null && share < LOW_ATTENDANCE_THRESHOLD,
    threshold: LOW_ATTENDANCE_THRESHOLD,
  };
}

/**
 * Tests the student's class has sat or will sit, with their own marks.
 *
 * An assessment dated ahead of today is one to prepare for; a null mark on a
 * past one means they did not sit it, which is not a zero.
 */
export async function getMyResults(ctx: TenantContext) {
  const me = await requireStudentSelf(ctx);
  const now = today();

  const assessments = await ctx.db.assessment.findMany({
    where: {
      sectionId: me.placement.sectionId,
      academicSessionId: me.placement.sessionId,
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      name: true,
      date: true,
      maxMarks: true,
      subject: { select: { id: true, name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      results: { where: { studentId: me.student.id }, select: { marksObtained: true, remarks: true } },
    },
  });

  const shape = (row: (typeof assessments)[number]) => {
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
      share: marks === null || row.maxMarks === 0 ? null : marks / row.maxMarks,
      note: result?.remarks ?? null,
      teacher: row.teacher ? fullName(row.teacher) : null,
      sat: marks !== null,
    };
  };

  const upcoming = assessments.filter((row) => row.date > now).map(shape).reverse();
  const past = assessments.filter((row) => row.date <= now).map(shape);

  return { me, upcoming, past, progress: subjectProgress(past) };
}

export type SubjectProgress = {
  subject: string;
  subjectId: string;
  average: number | null;
  latest: number | null;
  count: number;
  direction: "up" | "down" | "flat" | null;
};

/**
 * Subject averages from the marks themselves.
 *
 * A direction is only claimed once there are two results to compare — one mark
 * is a point, not a trend, and drawing an arrow from it would be invention.
 */
function subjectProgress(
  past: Array<{ subject: string; subjectId: string; share: number | null; sat: boolean }>,
): SubjectProgress[] {
  const groups = new Map<string, { subject: string; subjectId: string; shares: number[] }>();
  // Oldest first, so "latest" and the direction read forwards.
  for (const entry of [...past].reverse()) {
    if (!entry.sat || entry.share === null) continue;
    const group = groups.get(entry.subjectId) ?? {
      subject: entry.subject,
      subjectId: entry.subjectId,
      shares: [],
    };
    group.shares.push(entry.share);
    groups.set(entry.subjectId, group);
  }

  return [...groups.values()]
    .map((group) => {
      const { shares } = group;
      const first = shares[0];
      const last = shares[shares.length - 1];
      return {
        subject: group.subject,
        subjectId: group.subjectId,
        average: shares.reduce((a, b) => a + b, 0) / shares.length,
        latest: last ?? null,
        count: shares.length,
        direction:
          shares.length < 2 || first === undefined || last === undefined
            ? null
            : last > first + 0.02
              ? ("up" as const)
              : last < first - 0.02
                ? ("down" as const)
                : ("flat" as const),
      };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/** What this student's teachers have observed. Read-only. */
export async function getMyRemarks(ctx: TenantContext) {
  const me = await requireStudentSelf(ctx);

  const rows = await ctx.db.studentRemark.findMany({
    where: { studentId: me.student.id, academicSessionId: me.placement.sessionId },
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
    me,
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

/**
 * The student's own fee position.
 *
 * Starts from their own record like everything else here, so there is no id to
 * change. Read-only, and the same rows the office and their parents see.
 */
export async function getMyFees(ctx: TenantContext) {
  const me = await requireStudentSelf(ctx);
  const account = await readStudentFees(ctx, me.student.id, me.placement.sessionId);
  return { me, ...account };
}

/** The subjects this student is actually taught, for the filters. */
async function mySubjects(ctx: TenantContext, me: StudentContext) {
  const rows = await ctx.db.timetableSlot.findMany({
    where: {
      sectionId: me.placement.sectionId,
      academicSessionId: me.placement.sessionId,
    },
    distinct: ["subjectId"],
    orderBy: { subject: { name: "asc" } },
    select: { subject: { select: { id: true, name: true } } },
  });
  return rows.map((row) => row.subject);
}

export type { AttendanceCounts };
