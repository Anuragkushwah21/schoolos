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

  // Nobody can be in two rooms at once, cover included.
  const clash = await ctx.db.timetableSlot.findFirst({
    where: {
      teacherId: substitute.id,
      dayOfWeek: slot.dayOfWeek,
      NOT: { id: slot.id },
    },
    select: { id: true, startMinute: true, endMinute: true },
  });
  const period = await ctx.db.timetableSlot.findFirstOrThrow({
    where: { id: slot.id },
    select: { startMinute: true, endMinute: true },
  });
  if (clash && clash.startMinute < period.endMinute && period.startMinute < clash.endMinute) {
    throw new ConflictError(
      `${fullName(substitute)} already teaches another class at that time.`,
    );
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
