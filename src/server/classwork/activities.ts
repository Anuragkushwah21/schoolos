import "server-only";

import { addDays, dayOfWeek, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";

/**
 * What happened in a lesson — the teacher's record of one timetabled period.
 *
 * This is stored on `ClassSession`, the row that already represents "this slot
 * on this date". It deliberately holds no class, section, subject or session
 * of its own: all four are reached through `timetableSlot`. A teacher can
 * therefore never file an activity against a class they do not teach, because
 * the only way in is a slot that already names them.
 *
 * Authorization is the slot, not an id in the request: a teacher may write up
 * a period they are scheduled to teach, or one they actually took as a
 * substitute. Nothing else.
 */

/** Statuses a teacher may record. `SCHEDULED` is the absence of a record. */
export const ACTIVITY_STATUSES = [
  "COMPLETED",
  "SUBSTITUTE",
  "REMOTE",
  "MISSED",
  "CANCELLED",
] as const;

export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

/**
 * How far back a teacher may write up a lesson.
 *
 * The same seven days attendance allows, and for the same reason: a register
 * and a lesson record are the two halves of one day, and letting one be
 * rewritten months later while the other is frozen would make the pair
 * useless as a record.
 */
export const ACTIVITY_WINDOW_DAYS = 7;

const SLOT_SELECT = {
  id: true,
  dayOfWeek: true,
  startMinute: true,
  endMinute: true,
  room: true,
  teacherId: true,
  academicSessionId: true,
  subject: { select: { id: true, name: true } },
  section: {
    select: {
      id: true,
      name: true,
      class: { select: { name: true, level: true } },
      stream: { select: { name: true } },
    },
  },
} as const;

/**
 * The period this activity is about, once it is established that the teacher
 * may write it up.
 *
 * Two ways in, and only two: the period is theirs on the timetable, or the
 * office has named them the stand-in for that period on that date. A teacher
 * cannot make themselves a substitute by posting one — `assignSubstitute` is
 * the School Admin's to call.
 *
 * Refusals are deliberately indistinguishable: another school's slot, another
 * teacher's slot and a slot that does not exist all answer the same way, so
 * the response never confirms that an id is real.
 */
async function requireOwnSlot(ctx: TenantContext, timetableSlotId: string, date: Date) {
  const teacher = await requireTeacherSelf(ctx);

  const slot = await ctx.db.timetableSlot.findFirst({
    where: { id: timetableSlotId },
    select: SLOT_SELECT,
  });
  if (!slot) throw new ForbiddenError("That period is not one of yours.");

  if (slot.teacherId === teacher.id) {
    // Once the office has put a substitute in this period, the record is the
    // substitute's: the scheduled teacher writing it up would overwrite who
    // actually took the class.
    const covered = await ctx.db.classSession.findFirst({
      where: { timetableSlotId: slot.id, date, actualTeacherId: { not: null, notIn: [teacher.id] } },
      select: { actualTeacher: { select: { firstName: true, lastName: true } } },
    });
    if (covered?.actualTeacher) {
      throw new ConflictError(
        `${fullName(covered.actualTeacher)} was assigned to take this class, so they record it. Ask the school office if this is wrong.`,
      );
    }
    return { teacher, slot, standingIn: false };
  }

  // Not their period on the timetable — but the office may have put them in it
  // for this one date. A substitute writes up the class they actually took,
  // and the assignment, not the request, is what says they took it.
  const standIn = await ctx.db.classSession.findFirst({
    where: {
      timetableSlotId: slot.id,
      date,
      actualTeacherId: teacher.id,
    },
    select: { id: true },
  });

  if (!standIn) throw new ForbiddenError("That period is not one of yours.");

  return { teacher, slot, standingIn: true };
}

/** A lesson cannot be written up before it happens, or long after. */
function assertWritableDate(date: Date): void {
  const now = today();
  if (date > now) {
    throw new AppError("VALIDATION", "You cannot record a class before it happens.");
  }
  if (date < addDays(now, -ACTIVITY_WINDOW_DAYS)) {
    throw new ForbiddenError(
      `Classes can only be recorded within ${ACTIVITY_WINDOW_DAYS} days. Ask your school office to correct an older one.`,
    );
  }
}

export type ActivityInput = {
  timetableSlotId: string;
  date: Date;
  status: ActivityStatus;
  topic: string | null;
  notes: string | null;
  /** The short list students revise from — "practice questions 1-10". */
  importantPoints: string | null;
  /** What students should do before the next class. Left alone when absent. */
  preparation?: string | null;
  /** Homework set in this class; saved as a `Homework` row linked to it. */
  homeworkTitle?: string | null;
  homeworkDescription?: string | null;
  homeworkDueOn?: Date | null;
};

/** A class that did not happen cannot have set homework. */
const HOMEWORK_STATUSES: readonly ActivityStatus[] = ["COMPLETED", "SUBSTITUTE", "REMOTE"];

/**
 * Record — or correct — what happened in one period.
 *
 * Upserted on `(schoolId, timetableSlotId, date)`, so saving the same period
 * twice edits the first record instead of leaving two accounts of one lesson.
 * The unique index is what guarantees that, not this function.
 */
export async function recordActivity(
  ctx: TenantContext,
  input: ActivityInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");

  const { teacher, slot, standingIn } = await requireOwnSlot(
    ctx,
    input.timetableSlotId,
    input.date,
  );
  assertWritableDate(input.date);

  // The day the slot falls on is fixed by the timetable; a date that is not
  // that weekday would file Monday's lesson under Wednesday.
  if (dayOfWeek(input.date) !== slot.dayOfWeek) {
    throw new AppError("VALIDATION", "That period does not fall on that day of the week.");
  }

  if (input.homeworkTitle) {
    if (!HOMEWORK_STATUSES.includes(input.status)) {
      throw new AppError("VALIDATION", "Homework can only be set for a class that took place.");
    }
    if (!input.homeworkDueOn || input.homeworkDueOn < input.date) {
      throw new AppError("VALIDATION", "Give the homework a due date on or after the class.");
    }
  }

  const record = await ctx.db.classSession.upsert({
    where: {
      schoolId_timetableSlotId_date: {
        schoolId: ctx.schoolId,
        timetableSlotId: slot.id,
        date: input.date,
      },
    },
    create: {
      schoolId: ctx.schoolId,
      timetableSlotId: slot.id,
      date: input.date,
      status: input.status,
      scheduledTeacherId: slot.teacherId,
      actualTeacherId: teacher.id,
      topic: input.topic,
      notes: input.notes,
      importantPoints: input.importantPoints,
      preparation: input.preparation ?? null,
    },
    update: {
      // A substitute cannot rewrite the record as though the scheduled teacher
      // had taken the class: their own status choice is kept, but the fact that
      // somebody stood in is not erasable from here.
      status: standingIn && input.status === "COMPLETED" ? "SUBSTITUTE" : input.status,
      actualTeacherId: teacher.id,
      topic: input.topic,
      notes: input.notes,
      importantPoints: input.importantPoints,
      ...(input.preparation !== undefined ? { preparation: input.preparation } : {}),
    },
    select: { id: true },
  });

  // Homework set in the class is an ordinary `Homework` row, so it appears on
  // every homework list that already exists; the link makes re-saving the class
  // edit it rather than set it twice.
  if (input.homeworkTitle && input.homeworkDueOn) {
    await ctx.db.homework.upsert({
      where: { schoolId_classSessionId: { schoolId: ctx.schoolId, classSessionId: record.id } },
      create: {
        schoolId: ctx.schoolId,
        academicSessionId: slot.academicSessionId,
        sectionId: slot.section.id,
        subjectId: slot.subject.id,
        teacherId: teacher.id,
        classSessionId: record.id,
        title: input.homeworkTitle,
        description: input.homeworkDescription ?? null,
        assignedOn: input.date,
        dueOn: input.homeworkDueOn,
        status: "PUBLISHED",
      },
      update: {
        title: input.homeworkTitle,
        description: input.homeworkDescription ?? null,
        dueOn: input.homeworkDueOn,
      },
    });
  }

  await recordAudit({
    action: "CLASS_ACTIVITY_RECORDED",
    entityType: "ClassSession",
    entityId: record.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${slot.subject.name} for ${sectionLabel(slot.section)} recorded as ${input.status.toLowerCase()}.`,
  });

  return record;
}

export type ActivityFilters = {
  sectionId?: string | null;
  subjectId?: string | null;
  from?: Date | null;
  to?: Date | null;
  take?: number;
};

/**
 * The signed-in teacher's own lesson records, newest first.
 *
 * Scoped by the teacher rather than by the sections they can reach: a class
 * teacher may open any register in their section, but the lessons they wrote
 * up are only ever their own.
 *
 * "Their own" means either end of a substitution — the period they were
 * scheduled for, or the one they actually took standing in. A substitute who
 * writes a class up has to be able to read it back and correct it.
 */
export async function listMyActivities(ctx: TenantContext, filters: ActivityFilters = {}) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);

  const rows = await ctx.db.classSession.findMany({
    where: {
      OR: [{ scheduledTeacherId: teacher.id }, { actualTeacherId: teacher.id }],
      ...(filters.from || filters.to
        ? {
            date: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      timetableSlot: {
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: filters.take ?? 50,
    select: {
      id: true,
      date: true,
      status: true,
      topic: true,
      notes: true,
      updatedAt: true,
      timetableSlot: { select: SLOT_SELECT },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    status: row.status,
    topic: row.topic,
    notes: row.notes,
    updatedAt: row.updatedAt,
    slotId: row.timetableSlot.id,
    startMinute: row.timetableSlot.startMinute,
    endMinute: row.timetableSlot.endMinute,
    subject: row.timetableSlot.subject.name,
    subjectId: row.timetableSlot.subject.id,
    sectionId: row.timetableSlot.section.id,
    section: sectionLabel(row.timetableSlot.section),
    editable: row.date >= addDays(today(), -ACTIVITY_WINDOW_DAYS),
  }));
}

/**
 * Today's periods with whatever has already been written up against them.
 *
 * One query per concern and a join in memory, rather than a record lookup per
 * period: a teaching day is at most a dozen slots, and this keeps it at two
 * round trips whatever the timetable looks like.
 */
export async function getMyDayPlan(ctx: TenantContext, date: Date = today()) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);

  const [slots, recorded, covering] = await Promise.all([
    ctx.db.timetableSlot.findMany({
      where: {
        teacherId: teacher.id,
        academicSessionId: session.id,
        dayOfWeek: dayOfWeek(date),
      },
      orderBy: { startMinute: "asc" },
      select: SLOT_SELECT,
    }),
    ctx.db.classSession.findMany({
      where: { scheduledTeacherId: teacher.id, date },
      select: {
        timetableSlotId: true,
        status: true,
        topic: true,
        actualTeacher: { select: { firstName: true, lastName: true } },
      },
    }),
    // Periods the office has asked this teacher to cover today.
    ctx.db.classSession.findMany({
      where: { actualTeacherId: teacher.id, date, status: "SUBSTITUTE", NOT: { scheduledTeacherId: teacher.id } },
      select: {
        status: true,
        topic: true,
        scheduledTeacher: { select: { firstName: true, lastName: true } },
        timetableSlot: { select: SLOT_SELECT },
      },
    }),
  ]);

  const bySlot = new Map(recorded.map((row) => [row.timetableSlotId, row]));

  const own = slots.map((slot) => {
    const activity = bySlot.get(slot.id) ?? null;
    const coveredBy = activity?.status === "SUBSTITUTE" && activity.actualTeacher ? fullName(activity.actualTeacher) : null;
    return {
      slotId: slot.id,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      room: slot.room,
      subject: slot.subject.name,
      subjectId: slot.subject.id,
      sectionId: slot.section.id,
      section: sectionLabel(slot.section),
      status: activity?.status ?? null,
      topic: activity?.topic ?? null,
      recorded: activity !== null && !coveredBy,
      /** Another teacher is taking this period today. */
      coveredBy,
      /** This teacher is standing in for someone else. */
      coveringFor: null as string | null,
    };
  });
  const cover = covering.map((row) => ({
    slotId: row.timetableSlot.id,
    startMinute: row.timetableSlot.startMinute,
    endMinute: row.timetableSlot.endMinute,
    room: row.timetableSlot.room,
    subject: row.timetableSlot.subject.name,
    subjectId: row.timetableSlot.subject.id,
    sectionId: row.timetableSlot.section.id,
    section: sectionLabel(row.timetableSlot.section),
    status: row.status,
    topic: row.topic,
    recorded: Boolean(row.topic),
    coveredBy: null as string | null,
    coveringFor: fullName(row.scheduledTeacher),
  }));

  return {
    date,
    session,
    periods: [...own, ...cover].sort((a, b) => a.startMinute - b.startMinute),
  };
}

/**
 * One of the teacher's own records, for the edit form.
 *
 * As `listMyActivities`: the scheduled teacher, or the one who stood in.
 */
export async function getMyActivity(ctx: TenantContext, activityId: string) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);

  const row = await ctx.db.classSession.findFirst({
    where: {
      id: activityId,
      OR: [{ scheduledTeacherId: teacher.id }, { actualTeacherId: teacher.id }],
    },
    select: {
      id: true,
      date: true,
      status: true,
      topic: true,
      notes: true,
      importantPoints: true,
      plannedTopic: true,
      preparation: true,
      timetableSlot: { select: SLOT_SELECT },
      materials: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          title: true,
          url: true,
          body: true,
          description: true,
          fileName: true,
          fileSize: true,
        },
      },
      homework: {
        take: 1,
        select: { id: true, title: true, description: true, dueOn: true },
      },
    },
  });

  // Another teacher's record and a missing one are the same answer.
  if (!row) throw new NotFoundError("That class record was not found.");

  return row;
}
