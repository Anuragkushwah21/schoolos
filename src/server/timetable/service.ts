import "server-only";

import type { DayOfWeek } from "@/generated/prisma/enums";
import { DAY_LABEL, formatMinutes } from "@/lib/dates";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { SlotInput } from "@/lib/validation/timetable";
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
 */

const SLOT_SELECT = {
  id: true,
  dayOfWeek: true,
  startMinute: true,
  endMinute: true,
  room: true,
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

export type TimetableSlotView = Awaited<ReturnType<typeof getSectionTimetable>>[number];

function overlapMessage(
  who: string,
  clash: { dayOfWeek: DayOfWeek; startMinute: number; endMinute: number },
): string {
  return `${who} already has a period on ${DAY_LABEL[clash.dayOfWeek]} from ${formatMinutes(clash.startMinute)} to ${formatMinutes(clash.endMinute)}.`;
}

export async function createSlot(ctx: TenantContext, input: SlotInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);

  const [section, subject, teacher] = await Promise.all([
    ctx.db.section.findFirst({
      where: { id: input.sectionId, academicSessionId: session.id },
      select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
    }),
    ctx.db.subject.findFirst({ where: { id: input.subjectId, isActive: true }, select: { id: true, name: true } }),
    ctx.db.teacher.findFirst({
      where: { id: input.teacherId, status: { in: ["ACTIVE", "ON_LEAVE"] } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  if (!section || !subject || !teacher) throw new NotFoundError();

  const overlapping = {
    academicSessionId: session.id,
    dayOfWeek: input.dayOfWeek,
    startMinute: { lt: input.endMinute },
    endMinute: { gt: input.startMinute },
  };

  const [sectionClash, teacherClash] = await Promise.all([
    ctx.db.timetableSlot.findFirst({ where: { ...overlapping, sectionId: section.id } }),
    ctx.db.timetableSlot.findFirst({ where: { ...overlapping, teacherId: teacher.id } }),
  ]);
  if (sectionClash) throw new ConflictError(overlapMessage(sectionLabel(section), sectionClash));
  if (teacherClash) {
    throw new ConflictError(overlapMessage(`${teacher.firstName} ${teacher.lastName}`, teacherClash));
  }

  try {
    await ctx.db.$transaction(async (tx) => {
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
          room: input.room,
        },
      });

      // Teaching a period implies teaching the subject to that section, which
      // is also what lets the teacher mark its attendance.
      await tx.teacherSubjectAssignment.upsert({
        where: {
          schoolId_academicSessionId_teacherId_subjectId_sectionId: {
            schoolId: ctx.schoolId,
            academicSessionId: session.id,
            teacherId: teacher.id,
            subjectId: subject.id,
            sectionId: section.id,
          },
        },
        create: {
          schoolId: ctx.schoolId,
          academicSessionId: session.id,
          teacherId: teacher.id,
          subjectId: subject.id,
          sectionId: section.id,
        },
        update: {},
      });
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
    summary: `${subject.name} with ${teacher.firstName} ${teacher.lastName} added to ${sectionLabel(section)} on ${DAY_LABEL[input.dayOfWeek]} at ${formatMinutes(input.startMinute)}.`,
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
