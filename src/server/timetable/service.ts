import "server-only";

import type { DayOfWeek } from "@/generated/prisma/enums";
import { DAY_LABEL, formatMinutes } from "@/lib/dates";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { SlotInput, SlotUpdateInput } from "@/lib/validation/timetable";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { isUniqueViolation } from "@/server/db/errors";

/**
 * The weekly timetable.
 *
 * The schema forbids two periods starting at the same minute for one section
 * or one teacher. That catches exact collisions only, so partial overlaps
 * (9:00–9:55 against 9:30–10:25) are checked here before anything is written.
 *
 * Rooms come from School Setup → Rooms. A room is checked by id, and its row
 * is locked while a period is written, so two admins cannot book one room
 * for the same time in the same moment.
 */

const SLOT_SELECT = {
  id: true,
  dayOfWeek: true,
  startMinute: true,
  endMinute: true,
  room: true,
  roomId: true,
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  section: {
    select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
  },
} as const;

export async function getSectionTimetable(ctx: TenantContext, sectionId: string, academicSessionId: string) {
  return ctx.db.timetableSlot.findMany({
    where: { sectionId, academicSessionId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    select: SLOT_SELECT,
  });
}

export async function getTeacherTimetable(ctx: TenantContext, teacherId: string, academicSessionId: string) {
  return ctx.db.timetableSlot.findMany({
    where: { teacherId, academicSessionId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    select: SLOT_SELECT,
  });
}

/** Everything timetabled in one room this session. */
export async function getRoomTimetable(ctx: TenantContext, roomId: string, academicSessionId: string) {
  return ctx.db.timetableSlot.findMany({
    where: { academicSessionId, roomId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    select: SLOT_SELECT,
  });
}

export type TimetableSlotView = Awaited<ReturnType<typeof getSectionTimetable>>[number];

function overlapMessage(
  who: string,
  clash: { dayOfWeek: DayOfWeek; startMinute: number; endMinute: number },
): string {
  return `${who} already has a period on ${DAY_LABEL[clash.dayOfWeek]} from ${formatMinutes(clash.startMinute)} to ${formatMinutes(clash.endMinute)}.`;
}

/** A period as the service takes it; `roomId` may be left out for no room. */
type PeriodInput = Omit<SlotInput, "roomId" | "sectionId"> & { roomId?: string | null };

type SectionRef = { id: string; name: string; class: { name: string }; stream: { name: string } | null };

const SECTION_LABEL_SELECT = { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } } as const;

/**
 * Everything a period needs before it is written: the subject, teacher and
 * room exist (and are in use), and neither the section nor the teacher has
 * another period overlapping it. `exceptSlotId` is the period being edited.
 * The room clash is checked later, under the room's lock.
 */
async function checkPeriod(
  ctx: TenantContext,
  sessionId: string,
  section: SectionRef,
  input: PeriodInput,
  existing?: { id: string; roomId: string | null },
) {
  const roomId = input.roomId ?? null;
  const [subject, teacher, room] = await Promise.all([
    ctx.db.subject.findFirst({ where: { id: input.subjectId, isActive: true }, select: { id: true, name: true } }),
    ctx.db.teacher.findFirst({
      where: { id: input.teacherId, status: { in: ["ACTIVE", "ON_LEAVE"] } },
      select: { id: true, firstName: true, lastName: true },
    }),
    roomId ? ctx.db.room.findFirst({ where: { id: roomId }, select: { id: true, name: true, isActive: true } }) : Promise.resolve(null),
  ]);
  if (!subject || !teacher) throw new NotFoundError();
  if (roomId && !room) throw new NotFoundError("That room was not found. It may have been deleted — choose another.");
  // A deactivated room keeps the periods already in it, but takes no new ones.
  if (room && !room.isActive && existing?.roomId !== room.id) {
    throw new ConflictError(`Room ${room.name} is inactive. Choose another room, or activate it under School Setup → Rooms.`);
  }

  const overlapping = {
    academicSessionId: sessionId,
    dayOfWeek: input.dayOfWeek,
    startMinute: { lt: input.endMinute },
    endMinute: { gt: input.startMinute },
    ...(existing ? { id: { not: existing.id } } : {}),
  };
  const [sectionClash, teacherClash] = await Promise.all([
    ctx.db.timetableSlot.findFirst({ where: { ...overlapping, sectionId: section.id } }),
    ctx.db.timetableSlot.findFirst({ where: { ...overlapping, teacherId: teacher.id } }),
  ]);
  if (sectionClash) throw new ConflictError(overlapMessage(sectionLabel(section), sectionClash));
  if (teacherClash) {
    throw new ConflictError(overlapMessage(`${teacher.firstName} ${teacher.lastName}`, teacherClash));
  }
  return { subject, teacher, room, overlapping };
}

type Tx = Parameters<Parameters<TenantContext["db"]["$transaction"]>[0]>[0];

/**
 * Lock the room and make sure nothing else is in it at that time. Runs inside
 * the transaction that writes the period, so the check and the write cannot
 * be split by another admin's save.
 */
async function claimRoom(
  tx: Tx,
  schoolId: string,
  room: { id: string; name: string },
  overlapping: Record<string, unknown>,
) {
  await tx.room.updateMany({ where: { schoolId, id: room.id }, data: { updatedAt: new Date() } });
  const clash = await tx.timetableSlot.findFirst({
    where: { schoolId, ...overlapping, roomId: room.id },
    select: {
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
      subject: { select: { name: true } },
      section: { select: SECTION_LABEL_SELECT },
    },
  });
  if (clash) {
    throw new ConflictError(
      `Room ${room.name} is already occupied on ${DAY_LABEL[clash.dayOfWeek]} from ${formatMinutes(clash.startMinute)} to ${formatMinutes(clash.endMinute)} (${sectionLabel(clash.section)}, ${clash.subject.name}). Choose another room or time.`,
    );
  }
}

/**
 * Teaching a period implies teaching the subject to that section, which is
 * also what lets the teacher mark its attendance. An assignment the admin
 * already made — for the whole section or one stream — is kept as it is;
 * only a teacher with none gets a whole-section one.
 */
async function ensureAssignment(tx: Tx, schoolId: string, sessionId: string, sectionId: string, teacherId: string, subjectId: string) {
  const assigned = await tx.teacherSubjectAssignment.count({
    where: { schoolId, academicSessionId: sessionId, teacherId, subjectId, sectionId },
  });
  if (!assigned) {
    await tx.teacherSubjectAssignment.create({
      data: { schoolId, academicSessionId: sessionId, teacherId, subjectId, sectionId },
    });
  }
}

export async function createSlot(ctx: TenantContext, input: PeriodInput & { sectionId: string }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);

  const section = await ctx.db.section.findFirst({
    where: { id: input.sectionId, academicSessionId: session.id },
    select: SECTION_LABEL_SELECT,
  });
  if (!section) throw new NotFoundError();
  const { subject, teacher, room, overlapping } = await checkPeriod(ctx, session.id, section, input);

  try {
    await ctx.db.$transaction(async (tx) => {
      if (room) await claimRoom(tx, ctx.schoolId, room, overlapping);
      await tx.timetableSlot.create({
        data: {
          schoolId: ctx.schoolId,
          academicSessionId: session.id,
          sectionId: section.id,
          subjectId: subject.id,
          teacherId: teacher.id,
          dayOfWeek: input.dayOfWeek,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          roomId: room?.id ?? null,
          room: room?.name ?? null,
        },
      });
      await ensureAssignment(tx, ctx.schoolId, session.id, section.id, teacher.id, subject.id);
    });
  } catch (error) {
    // Two admins saving the same slot at once: the unique index wins.
    if (isUniqueViolation(error)) throw new ConflictError("That time is already taken.");
    throw error;
  }

  await recordAudit({
    action: "TIMETABLE_UPDATED",
    entityType: "Section",
    entityId: section.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${subject.name} with ${teacher.firstName} ${teacher.lastName} added to ${sectionLabel(section)} on ${DAY_LABEL[input.dayOfWeek]} at ${formatMinutes(input.startMinute)}${room ? ` in ${room.name}` : ""}.`,
  });
}

/** One period of this session's timetable, for the edit form. */
export async function getSlot(ctx: TenantContext, slotId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);
  const slot = await ctx.db.timetableSlot.findFirst({
    where: { id: slotId, academicSessionId: session.id },
    select: { ...SLOT_SELECT, sectionId: true, subjectId: true, teacherId: true, _count: { select: { classSessions: true } } },
  });
  if (!slot) throw new NotFoundError("That period was not found in this session's timetable.");
  const { _count, ...rest } = slot;
  return { ...rest, hasRecords: _count.classSessions > 0 };
}

/**
 * Edit a period of this session's timetable. Once lessons have been recorded
 * against it, only its room can change — its day, time, subject and teacher
 * are what those records describe.
 */
export async function updateSlot(ctx: TenantContext, input: Omit<SlotUpdateInput, "roomId"> & { roomId?: string | null }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);
  const slot = await ctx.db.timetableSlot.findFirst({
    where: { id: input.slotId, academicSessionId: session.id },
    select: {
      id: true,
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
      subjectId: true,
      teacherId: true,
      roomId: true,
      section: { select: SECTION_LABEL_SELECT },
      _count: { select: { classSessions: true } },
    },
  });
  if (!slot) throw new NotFoundError("That period was not found in this session's timetable.");

  const lessonChanged =
    slot.dayOfWeek !== input.dayOfWeek ||
    slot.startMinute !== input.startMinute ||
    slot.endMinute !== input.endMinute ||
    slot.subjectId !== input.subjectId ||
    slot.teacherId !== input.teacherId;
  if (lessonChanged && slot._count.classSessions) {
    throw new ConflictError(
      "Lessons have already been recorded for this period, so only its room can change. To change the day, time, subject or teacher, add a new period.",
    );
  }

  const { subject, teacher, room, overlapping } = await checkPeriod(ctx, session.id, slot.section, input, slot);

  try {
    await ctx.db.$transaction(async (tx) => {
      if (room) await claimRoom(tx, ctx.schoolId, room, overlapping);
      await tx.timetableSlot.updateMany({
        where: { schoolId: ctx.schoolId, id: slot.id },
        data: {
          subjectId: subject.id,
          teacherId: teacher.id,
          dayOfWeek: input.dayOfWeek,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          roomId: room?.id ?? null,
          room: room?.name ?? null,
        },
      });
      await ensureAssignment(tx, ctx.schoolId, session.id, slot.section.id, teacher.id, subject.id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That time is already taken.");
    throw error;
  }

  await recordAudit({
    action: "TIMETABLE_UPDATED",
    entityType: "Section",
    entityId: slot.section.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Period changed: ${subject.name} with ${teacher.firstName} ${teacher.lastName}, ${sectionLabel(slot.section)}, ${DAY_LABEL[input.dayOfWeek]} at ${formatMinutes(input.startMinute)}${room ? ` in ${room.name}` : ", no room"}.`,
  });
}

export async function deleteSlot(ctx: TenantContext, slotId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const slot = await ctx.db.timetableSlot.findFirst({
    where: { id: slotId },
    select: { id: true, sectionId: true, _count: { select: { classSessions: true } } },
  });
  if (!slot) throw new NotFoundError();
  if (slot._count.classSessions) {
    throw new ConflictError("This period already has class records and cannot be removed.");
  }

  await ctx.db.timetableSlot.deleteMany({ where: { id: slot.id } });
  await recordAudit({
    action: "TIMETABLE_UPDATED",
    entityType: "Section",
    entityId: slot.sectionId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: "Timetable period removed.",
  });
}
