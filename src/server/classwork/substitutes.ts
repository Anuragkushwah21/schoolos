import "server-only";

import { addDays, dayOfWeek, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { ACTIVITY_WINDOW_DAYS } from "@/server/classwork/activities";

/**
 * Covering an absent teacher's period.
 *
 * The School Admin's side of class continuity. Assigning a substitute is the
 * one thing that lets somebody other than the scheduled teacher write up a
 * period, which is why it lives here rather than anywhere a teacher can reach:
 * the grant and the use of it are deliberately in different hands.
 *
 * A teacher being absent does not cancel their classes. This creates the
 * `ClassSession` row for that period on that date with the stand-in named on
 * it; what actually happened in the room is still theirs to record afterwards.
 */

/** How far ahead cover can be arranged. A term of notice is not a substitute. */
const LOOKAHEAD_DAYS = 14;

export type SubstituteInput = {
  timetableSlotId: string;
  date: Date;
  /** The teacher standing in. Not the scheduled one. */
  teacherId: string;
};

export async function assignSubstitute(
  ctx: TenantContext,
  input: SubstituteInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const now = today();
  if (input.date < addDays(now, -ACTIVITY_WINDOW_DAYS)) {
    throw new AppError(
      "VALIDATION",
      `Cover can only be arranged within the last ${ACTIVITY_WINDOW_DAYS} days.`,
    );
  }
  if (input.date > addDays(now, LOOKAHEAD_DAYS)) {
    throw new AppError("VALIDATION", `Cover can only be arranged up to ${LOOKAHEAD_DAYS} days ahead.`);
  }

  const slot = await ctx.db.timetableSlot.findFirst({
    where: { id: input.timetableSlotId },
    select: {
      id: true,
      dayOfWeek: true,
      teacherId: true,
      subject: { select: { name: true } },
      section: {
        select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
      },
    },
  });
  if (!slot) throw new NotFoundError("That period was not found.");

  // The timetable fixes which weekday the period falls on.
  if (dayOfWeek(input.date) !== slot.dayOfWeek) {
    throw new AppError("VALIDATION", "That period does not fall on that day of the week.");
  }

  if (slot.teacherId === input.teacherId) {
    throw new ConflictError("That teacher already takes this period; no cover is needed.");
  }

  const substitute = await ctx.db.teacher.findFirst({
    where: { id: input.teacherId, status: { in: ["ACTIVE", "ON_LEAVE"] } },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!substitute) throw new NotFoundError("That teacher was not found.");

  // Nobody can be in two rooms at once, cover included: not in one of their
  // own periods, not covering another class at the same time, and not away.
  const period = await ctx.db.timetableSlot.findFirstOrThrow({
    where: { id: slot.id },
    select: { startMinute: true, endMinute: true, academicSessionId: true },
  });
  const overlaps = { startMinute: { lt: period.endMinute }, endMinute: { gt: period.startMinute } };
  const [ownClash, coverClash, away, onLeave] = await Promise.all([
    ctx.db.timetableSlot.findFirst({
      where: {
        teacherId: substitute.id,
        academicSessionId: period.academicSessionId,
        dayOfWeek: slot.dayOfWeek,
        NOT: { id: slot.id },
        ...overlaps,
      },
      select: { id: true },
    }),
    ctx.db.classSession.findFirst({
      where: {
        actualTeacherId: substitute.id,
        date: input.date,
        status: "SUBSTITUTE",
        NOT: { timetableSlotId: slot.id },
        timetableSlot: overlaps,
      },
      select: { id: true },
    }),
    ctx.db.teacherAttendance.findFirst({
      where: { teacherId: substitute.id, date: input.date, status: { in: ["ABSENT", "ON_LEAVE"] } },
      select: { id: true },
    }),
    ctx.db.leaveRequest.findFirst({
      where: { teacherId: substitute.id, status: "APPROVED", startDate: { lte: input.date }, endDate: { gte: input.date } },
      select: { id: true },
    }),
  ]);
  if (ownClash) throw new ConflictError(`${fullName(substitute)} already teaches another class at that time.`);
  if (coverClash) throw new ConflictError(`${fullName(substitute)} is already covering another class at that time.`);
  if (away || onLeave) throw new ConflictError(`${fullName(substitute)} is absent or on leave that day.`);

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
      status: "SUBSTITUTE",
      scheduledTeacherId: slot.teacherId,
      actualTeacherId: substitute.id,
    },
    // Re-assigning cover replaces the stand-in and leaves whatever they had
    // already written up in place, so a swap does not lose the lesson record.
    update: { status: "SUBSTITUTE", actualTeacherId: substitute.id },
    select: { id: true },
  });

  await recordAudit({
    action: "CLASS_SUBSTITUTE_ASSIGNED",
    entityType: "ClassSession",
    entityId: record.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(substitute)} covering ${slot.subject.name} for ${sectionLabel(slot.section)}.`,
  });

  return record;
}

/** Hand the period back to the teacher it belongs to. */
export async function clearSubstitute(ctx: TenantContext, classSessionId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const record = await ctx.db.classSession.findFirst({
    where: { id: classSessionId },
    select: { id: true, status: true, scheduledTeacherId: true },
  });
  if (!record) throw new NotFoundError("That class record was not found.");
  if (record.status !== "SUBSTITUTE") {
    throw new ConflictError("Nobody is covering that period.");
  }

  await ctx.db.classSession.updateMany({
    where: { id: record.id },
    // Back to un-written-up: the scheduled teacher records it as normal.
    data: { status: "SCHEDULED", actualTeacherId: null },
  });

  await recordAudit({
    action: "CLASS_SUBSTITUTE_CLEARED",
    entityType: "ClassSession",
    entityId: record.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: "Cover removed; period returned to its scheduled teacher.",
  });
}

// -----------------------------------------------------------------------------
// Cover planning (School Admin)
// -----------------------------------------------------------------------------

export const COVER_BACK_DAYS = ACTIVITY_WINDOW_DAYS;
export const COVER_AHEAD_DAYS = LOOKAHEAD_DAYS;

/**
 * Everything the office needs to arrange cover for one day: who is away (absent
 * in the staff register, or on approved leave), which of their periods need a
 * substitute, who is already covering, and — for each period — the teachers
 * free at that time. "Free" means not away themselves, not teaching one of
 * their own periods then, and not already covering another class then.
 */
export async function getCoverPlan(ctx: TenantContext, date: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const now = today();
  const inWindow = date >= addDays(now, -COVER_BACK_DAYS) && date <= addDays(now, COVER_AHEAD_DAYS);

  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) return { date, inWindow, absentees: [], covers: [] };
  const weekday = dayOfWeek(date);

  const [marks, leaves, teachers, slots, covers] = await Promise.all([
    ctx.db.teacherAttendance.findMany({
      where: { date, status: { in: ["ABSENT", "ON_LEAVE"] } },
      select: { teacherId: true, status: true },
    }),
    ctx.db.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
      select: { teacherId: true, type: true },
    }),
    ctx.db.teacher.findMany({
      where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, status: true },
    }),
    ctx.db.timetableSlot.findMany({
      where: { academicSessionId: session.id, dayOfWeek: weekday },
      orderBy: { startMinute: "asc" },
      select: {
        id: true,
        teacherId: true,
        startMinute: true,
        endMinute: true,
        room: true,
        subject: { select: { name: true } },
        section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
      },
    }),
    ctx.db.classSession.findMany({
      where: { date, status: "SUBSTITUTE", actualTeacherId: { not: null } },
      select: { id: true, timetableSlotId: true, actualTeacherId: true },
    }),
  ]);

  const reasonFor = new Map<string, string>();
  for (const leave of leaves) reasonFor.set(leave.teacherId, `On ${leave.type.toLowerCase().replace(/_/g, " ")} leave`);
  for (const mark of marks) if (!reasonFor.has(mark.teacherId)) reasonFor.set(mark.teacherId, mark.status === "ABSENT" ? "Absent" : "On leave");

  const nameOf = new Map(teachers.map((teacher) => [teacher.id, fullName(teacher)]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const coverBySlot = new Map(covers.map((cover) => [cover.timetableSlotId, cover]));

  const busy = (teacherId: string, start: number, end: number, exceptSlot: string) =>
    slots.some((slot) => slot.teacherId === teacherId && slot.id !== exceptSlot && slot.startMinute < end && start < slot.endMinute) ||
    covers.some((cover) => {
      if (cover.actualTeacherId !== teacherId || cover.timetableSlotId === exceptSlot) return false;
      const covered = slotById.get(cover.timetableSlotId);
      return covered ? covered.startMinute < end && start < covered.endMinute : false;
    });

  const absentees = [...reasonFor.entries()]
    .filter(([teacherId]) => nameOf.has(teacherId))
    .map(([teacherId, reason]) => ({
      teacherId,
      name: nameOf.get(teacherId)!,
      reason,
      periods: slots
        .filter((slot) => slot.teacherId === teacherId)
        .map((slot) => {
          const cover = coverBySlot.get(slot.id);
          return {
            slotId: slot.id,
            startMinute: slot.startMinute,
            endMinute: slot.endMinute,
            subject: slot.subject.name,
            section: sectionLabel(slot.section),
            room: slot.room,
            cover: cover?.actualTeacherId
              ? { classSessionId: cover.id, teacherId: cover.actualTeacherId, name: nameOf.get(cover.actualTeacherId) ?? "—" }
              : null,
            candidates: teachers
              .filter(
                (teacher) =>
                  teacher.id !== teacherId &&
                  teacher.status === "ACTIVE" &&
                  !reasonFor.has(teacher.id) &&
                  !busy(teacher.id, slot.startMinute, slot.endMinute, slot.id),
              )
              .map((teacher) => ({ id: teacher.id, name: fullName(teacher) })),
          };
        }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { date, inWindow, absentees, covers: covers.length };
}
