import "server-only";

import type { PtmAttendance, PtmResponse } from "@/generated/prisma/enums";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { isSchoolLeader } from "@/lib/permissions";
import { meetingStatus, schoolNow } from "@/lib/time-status";
import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { accessibleSectionIds, requireTeacherSelf } from "@/server/auth/teacher-access";

import { visibleMeetingWhere } from "./meetings";

/**
 * Parent-teacher meetings, the simple way: the office announces a PTM (a
 * Meeting of type PTM, `meetings.ts`); each family may say "Will attend" or
 * "Unable to attend" until it ends; afterwards a teacher records what
 * actually happened — Attended, Did not attend or Rescheduled — with
 * optional notes. No slots, no bookings.
 *
 *   * One `PtmFamily` row per PTM and child, so neither an answer nor a
 *     record can be duplicated.
 *   * The parent's answer and the recorded attendance are separate fields: a
 *     parent who said yes can still be marked "Did not attend".
 *   * Remarks and follow-up notes are staff-only: never returned to a parent
 *     or student by anything here.
 *   * Who may see or record a class comes from the database, never the
 *     request: a teacher sees the sections they teach or are class teacher
 *     of, and records only for sections they are class teacher of; the
 *     School Admin and Principal see and record all.
 */

export const RESPONSE_LABEL: Record<PtmResponse, string> = { WILL_ATTEND: "Will attend", UNABLE_TO_ATTEND: "Unable to attend" };
export const ATTENDANCE_LABEL: Record<PtmAttendance, string> = { ATTENDED: "Attended", DID_NOT_ATTEND: "Did not attend", RESCHEDULED: "Rescheduled" };

const PTM_SELECT = { id: true, type: true, title: true, status: true, date: true, startMinute: true, endMinute: true, scope: true, audiences: true, academicSessionId: true, sections: { select: { sectionId: true } }, students: { select: { studentId: true } } } as const;

/** A PTM the signed-in user is invited to (leaders: any of the school's). */
async function loadPtm(ctx: TenantContext, meetingId: string) {
  const row = await ctx.db.meeting.findFirst({ where: { AND: [{ id: meetingId, type: "PTM" }, await visibleMeetingWhere(ctx)] }, select: PTM_SELECT });
  if (!row) throw new NotFoundError("That parent-teacher meeting was not found.");
  return row;
}

type Ptm = Awaited<ReturnType<typeof loadPtm>>;

/** Whether families are part of it (parents invited). */
function forFamilies(ptm: Ptm): boolean {
  return ptm.audiences.includes("ALL") || ptm.audiences.includes("PARENTS");
}

/** The children a PTM is for, with their current section — from the meeting's own targeting. */
async function roster(ctx: TenantContext, ptm: Ptm, sectionIds: string[] | null = null) {
  if (!forFamilies(ptm)) return [];
  const sessionWhere = { academicSession: { isCurrent: true }, status: "ACTIVE" as const };
  const target =
    ptm.scope === "SECTIONS"
      ? { sectionId: { in: ptm.sections.map((row) => row.sectionId) } }
      : ptm.scope === "PEOPLE"
        ? { studentId: { in: ptm.students.map((row) => row.studentId) } }
        : {};
  return ctx.db.studentEnrollment.findMany({
    where: { ...sessionWhere, ...target, ...(sectionIds ? { sectionId: { in: sectionIds } } : {}), student: { status: { in: [...CURRENT_STUDENT] } } },
    orderBy: [{ section: { class: { level: "asc" } } }, { section: { name: "asc" } }, { rollNumber: "asc" }],
    select: {
      sectionId: true,
      rollNumber: true,
      section: { select: { name: true, classTeacherId: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } },
      student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, parents: { orderBy: { isPrimary: "desc" }, select: { parent: { select: { firstName: true, lastName: true } } } } } },
    },
  });
}

// --- families ------------------------------------------------------------------

/**
 * A parent's PTMs, each with their children it is for and their answer.
 * `canRespond` is false once the PTM has ended or was cancelled.
 */
export async function myPtmResponses(ctx: TenantContext) {
  assertRole(ctx.user, "PARENT");
  const children = await ctx.db.student.findMany({ where: { parents: { some: { parent: { userId: ctx.user.id } } }, status: { in: [...CURRENT_STUDENT] } }, select: { id: true } });
  if (!children.length) return {} as Record<string, Array<{ studentId: string; name: string; response: PtmResponse | null; canRespond: boolean }>>;
  const ptms = await ctx.db.meeting.findMany({ where: { AND: [{ type: "PTM" }, await visibleMeetingWhere(ctx)] }, orderBy: { date: "desc" }, take: 30, select: PTM_SELECT });
  const clock = schoolNow();
  const out: Record<string, Array<{ studentId: string; name: string; response: PtmResponse | null; canRespond: boolean }>> = {};
  const childIds = new Set(children.map((child) => child.id));
  for (const ptm of ptms) {
    const mine = (await roster(ctx, ptm)).filter((row) => childIds.has(row.student.id));
    if (!mine.length) continue;
    const answers = await ctx.db.ptmFamily.findMany({ where: { meetingId: ptm.id, studentId: { in: mine.map((row) => row.student.id) } }, select: { studentId: true, response: true } });
    const status = meetingStatus(ptm, clock);
    out[ptm.id] = mine.map((row) => ({
      studentId: row.student.id,
      name: fullName(row.student),
      response: answers.find((answer) => answer.studentId === row.student.id)?.response ?? null,
      canRespond: status === "UPCOMING" || status === "ONGOING",
    }));
  }
  return out;
}

/** A parent answers for one of their own children, until the PTM ends. Answering again replaces the answer. */
export async function respondToPtm(ctx: TenantContext, input: { meetingId: string; studentId: string; response: PtmResponse }) {
  assertRole(ctx.user, "PARENT");
  const linked = await ctx.db.student.findFirst({ where: { id: input.studentId, parents: { some: { parent: { userId: ctx.user.id } } }, status: { in: [...CURRENT_STUDENT] } }, select: { id: true, firstName: true, lastName: true } });
  // Another family's child (or another school's) answers as "not found".
  if (!linked) throw new NotFoundError("That child was not found.");
  const ptm = await loadPtm(ctx, input.meetingId);
  const status = meetingStatus(ptm, schoolNow());
  if (status === "CANCELLED") throw new ConflictError("This parent-teacher meeting was cancelled.");
  if (status === "COMPLETED") throw new ConflictError("This parent-teacher meeting is over, so the answer can no longer be changed.");
  if (!(await roster(ctx, ptm)).some((row) => row.student.id === linked.id)) throw new NotFoundError("This meeting is not for that child's class.");

  await ctx.db.ptmFamily.upsert({
    where: { schoolId_meetingId_studentId: { schoolId: ctx.schoolId, meetingId: ptm.id, studentId: linked.id } },
    create: { schoolId: ctx.schoolId, meetingId: ptm.id, studentId: linked.id, response: input.response, respondedById: ctx.user.id, respondedAt: new Date() },
    update: { response: input.response, respondedById: ctx.user.id, respondedAt: new Date() },
  });
  await recordAudit({ action: "PTM_RESPONSE_SAVED", entityType: "Meeting", entityId: ptm.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${RESPONSE_LABEL[input.response]} — ${fullName(linked)}, "${ptm.title}".` });
}

// --- staff -----------------------------------------------------------------------

/** The sections this person may see on a PTM list, and which of them they may record for. */
async function staffScope(ctx: TenantContext): Promise<{ sectionIds: string[] | null; recordable: (classTeacherId: string | null) => boolean }> {
  if (isSchoolLeader(ctx.user.role)) return { sectionIds: null, recordable: () => true };
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const reachable = session ? await accessibleSectionIds(ctx, session.id) : [];
  return { sectionIds: Array.isArray(reachable) ? reachable : [], recordable: (classTeacherId) => classTeacherId === teacher.id };
}

/**
 * Class-wise families for a PTM: each child with their parents, the
 * parent's answer, and what was recorded. Staff only.
 */
export async function ptmClassList(ctx: TenantContext, meetingId: string) {
  // Staff only — refused before anything about the meeting is looked up.
  if (!isSchoolLeader(ctx.user.role)) assertRole(ctx.user, "TEACHER");
  const ptm = await loadPtm(ctx, meetingId);
  const scope = await staffScope(ctx);
  const rows = await roster(ctx, ptm, scope.sectionIds);
  const records = rows.length ? await ctx.db.ptmFamily.findMany({ where: { meetingId: ptm.id, studentId: { in: rows.map((row) => row.student.id) } } }) : [];
  const byStudent = new Map(records.map((row) => [row.studentId, row]));
  const status = meetingStatus(ptm, schoolNow());
  const sections = new Map<string, { sectionId: string; label: string; canRecord: boolean; families: Array<{ studentId: string; name: string; admissionNumber: string; rollNumber: string | null; parents: string; response: PtmResponse | null; attendance: PtmAttendance | null; remarks: string | null; followUp: string | null }> }>();
  for (const row of rows) {
    const entry = sections.get(row.sectionId) ?? { sectionId: row.sectionId, label: sectionLabel(row.section), canRecord: scope.recordable(row.section.classTeacherId), families: [] };
    const record = byStudent.get(row.student.id);
    entry.families.push({
      studentId: row.student.id,
      name: fullName(row.student),
      admissionNumber: row.student.admissionNumber,
      rollNumber: row.rollNumber,
      parents: row.student.parents.map((link) => fullName(link.parent)).join(", ") || "No parent linked",
      response: record?.response ?? null,
      attendance: record?.attendance ?? null,
      remarks: record?.remarks ?? null,
      followUp: record?.followUp ?? null,
    });
    sections.set(row.sectionId, entry);
  }
  const families = rows.length;
  const summary = {
    families,
    willAttend: records.filter((row) => row.response === "WILL_ATTEND").length,
    unable: records.filter((row) => row.response === "UNABLE_TO_ATTEND").length,
    attended: records.filter((row) => row.attendance === "ATTENDED").length,
    recorded: records.filter((row) => row.attendance !== null).length,
  };
  return { ptm: { id: ptm.id, title: ptm.title, date: ptm.date, startMinute: ptm.startMinute, endMinute: ptm.endMinute, status }, canRecordNow: status === "ONGOING" || status === "COMPLETED", sections: [...sections.values()], summary: { ...summary, notResponded: families - summary.willAttend - summary.unable } };
}

/**
 * Record what happened for one family — once the PTM has started, never for
 * a cancelled one. Only the class teacher of the child's section (or the
 * School Admin / Principal). Recording again corrects it.
 */
export async function recordPtmAttendance(ctx: TenantContext, input: { meetingId: string; studentId: string; attendance: PtmAttendance; remarks: string | null; followUp: string | null }) {
  if (!isSchoolLeader(ctx.user.role)) assertRole(ctx.user, "TEACHER");
  const ptm = await loadPtm(ctx, input.meetingId);
  const status = meetingStatus(ptm, schoolNow());
  if (status === "CANCELLED") throw new ConflictError("This parent-teacher meeting was cancelled.");
  if (status === "UPCOMING") throw new ConflictError("Attendance can be recorded once the meeting has started.");
  const scope = await staffScope(ctx);
  const row = (await roster(ctx, ptm, scope.sectionIds)).find((entry) => entry.student.id === input.studentId);
  if (!row) throw new NotFoundError("That student is not on this meeting's list for your classes.");
  if (!scope.recordable(row.section.classTeacherId)) throw new ForbiddenError("Only the class teacher of this class (or the school office) records PTM attendance.");
  if ((input.remarks?.length ?? 0) > 2000 || (input.followUp?.length ?? 0) > 2000) throw new ValidationError("Please keep notes under 2,000 characters.");

  const before = await ctx.db.ptmFamily.findFirst({ where: { meetingId: ptm.id, studentId: row.student.id }, select: { attendance: true } });
  await ctx.db.ptmFamily.upsert({
    where: { schoolId_meetingId_studentId: { schoolId: ctx.schoolId, meetingId: ptm.id, studentId: row.student.id } },
    create: { schoolId: ctx.schoolId, meetingId: ptm.id, studentId: row.student.id, attendance: input.attendance, remarks: input.remarks, followUp: input.followUp, recordedById: ctx.user.id, recordedAt: new Date() },
    update: { attendance: input.attendance, remarks: input.remarks, followUp: input.followUp, recordedById: ctx.user.id, recordedAt: new Date() },
  });
  // The audit says what changed, never the private notes themselves.
  await recordAudit({
    action: "PTM_ATTENDANCE_RECORDED",
    entityType: "Meeting",
    entityId: ptm.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(row.student)}: ${before?.attendance ? `${ATTENDANCE_LABEL[before.attendance]} → ` : ""}${ATTENDANCE_LABEL[input.attendance]}${input.remarks || input.followUp ? " (notes recorded)" : ""} — "${ptm.title}".`,
  });
}
