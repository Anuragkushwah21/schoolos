import "server-only";

import { addDays, formatDate, today } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { isSchoolLeader } from "@/lib/permissions";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";
import { requireTeacherSelf } from "@/server/auth/teacher-access";

import { needsAttention } from "./attention";

/**
 * The other two signals beside marks (`attention.ts`): attendance and
 * homework. Both are prompts for a person to look, never a label or a
 * decision — each row says exactly what was seen:
 *
 *   * ATTENDANCE — attendance below the school's threshold (default 75%) over
 *     its window (default the last 30 days), counting only days a register
 *     was marked for the student; approved leave is not counted against
 *     them, a half day counts as half. Needs at least 5 marked days.
 *   * HOMEWORK — a teacher's own remark in that window saying homework is
 *     frequently missing (SchoolOS does not track each submission).
 *
 * Only real marks and remarks are read; nothing is estimated.
 */

export type SignalReason = { code: "ATTENDANCE" | "HOMEWORK"; text: string };
export type SignalRow = { studentId: string; student: string; admissionNumber: string; sectionId: string; section: string; reasons: SignalReason[]; attendancePercent: number | null; supportId: string | null };

const MIN_DAYS = 5;
const OPEN_SUPPORT = ["NEW", "REVIEWING", "SUPPORT_PLANNED", "IN_PROGRESS", "IMPROVING"] as const;

export async function signalSettings(ctx: TenantContext) {
  const school = await ctx.db.school.findFirst({ select: { attendanceAttentionPercent: true, attendanceAttentionDays: true } });
  return { percent: school?.attendanceAttentionPercent ?? 75, days: school?.attendanceAttentionDays ?? 30 };
}

export function signalRule(settings: { percent: number; days: number }): string {
  return `Attendance needs attention below ${settings.percent}% over the last ${settings.days} days (approved leave not counted against the student, at least ${MIN_DAYS} marked days). Homework needs attention when a teacher has noted it as frequently missing in that time.`;
}

export async function saveSignalSettings(ctx: TenantContext, input: { percent: number; days: number }): Promise<void> {
  assertCan(ctx, "settings", "EDIT");
  if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 99) throw new AppError("VALIDATION", "Choose an attendance threshold from 1% to 99%.");
  if (!Number.isInteger(input.days) || input.days < 7 || input.days > 120) throw new AppError("VALIDATION", "Choose a window from 7 to 120 days.");
  await ctx.db.school.update({ where: { id: ctx.schoolId }, data: { attendanceAttentionPercent: input.percent, attendanceAttentionDays: input.days } });
  await recordAudit({ action: "ATTENTION_SETTINGS_UPDATED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Attendance attention: below ${input.percent}% over ${input.days} days.` });
}

/** The sections this person may see signals for: leaders all; a teacher the sections they are class teacher of or teach. */
async function scopeSections(ctx: TenantContext, sessionId: string): Promise<string[] | null> {
  if (isSchoolLeader(ctx.user.role)) return null;
  if (ctx.user.role !== "TEACHER") return [];
  const teacher = await requireTeacherSelf(ctx);
  const [classSections, taught] = await Promise.all([
    ctx.db.section.findMany({ where: { classTeacherId: teacher.id, academicSessionId: sessionId }, select: { id: true } }),
    ctx.db.teacherSubjectAssignment.findMany({ where: { teacherId: teacher.id, academicSessionId: sessionId }, select: { sectionId: true } }),
  ]);
  return [...new Set([...classSections.map((row) => row.id), ...taught.map((row) => row.sectionId)])];
}

/** Students whose attendance or homework needs a look, with the reason in words. */
export async function attendanceHomeworkSignals(ctx: TenantContext, filters: { sectionId?: string } = {}) {
  const settings = await signalSettings(ctx);
  const rule = signalRule(settings);
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) return { rows: [] as SignalRow[], settings, rule };
  const scope = await scopeSections(ctx, session.id);
  if (scope && !scope.length) return { rows: [] as SignalRow[], settings, rule };
  const sectionWhere = filters.sectionId ? (scope && !scope.includes(filters.sectionId) ? { in: [] as string[] } : filters.sectionId) : scope ? { in: scope } : undefined;
  const since = addDays(today(), -settings.days);

  const enrollments = await ctx.db.studentEnrollment.findMany({
    where: { academicSessionId: session.id, status: "ACTIVE", student: { status: "ACTIVE" }, ...(sectionWhere ? { sectionId: sectionWhere } : {}) },
    select: { sectionId: true, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } }, student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
  });
  const ids = enrollments.map((row) => row.student.id);
  if (!ids.length) return { rows: [] as SignalRow[], settings, rule };

  const [marks, remarks, supports] = await Promise.all([
    ctx.db.studentAttendance.groupBy({ by: ["studentId", "status"], where: { studentId: { in: ids }, date: { gte: since, lte: today() } }, _count: { _all: true } }),
    ctx.db.studentRemark.findMany({ where: { studentId: { in: ids }, homeworkHabit: "FREQUENTLY_MISSING", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { studentId: true, createdAt: true, teacher: { select: { firstName: true, lastName: true } }, subject: { select: { name: true } } } }),
    ctx.db.studentSupport.findMany({ where: { studentId: { in: ids }, academicSessionId: session.id, status: { in: [...OPEN_SUPPORT] } }, select: { id: true, studentId: true } }),
  ]);

  const tally = new Map<string, Record<string, number>>();
  for (const row of marks) {
    const entry = tally.get(row.studentId) ?? {};
    entry[row.status] = (entry[row.status] ?? 0) + row._count._all;
    tally.set(row.studentId, entry);
  }
  const latestRemark = new Map<string, (typeof remarks)[number]>();
  for (const remark of remarks) if (!latestRemark.has(remark.studentId)) latestRemark.set(remark.studentId, remark);
  const support = new Map(supports.map((row) => [row.studentId, row.id]));

  const rows: SignalRow[] = [];
  for (const enrollment of enrollments) {
    const id = enrollment.student.id;
    const reasons: SignalReason[] = [];
    const counts = tally.get(id) ?? {};
    const present = counts.PRESENT ?? 0;
    const late = counts.LATE ?? 0;
    const half = counts.HALF_DAY ?? 0;
    const absent = counts.ABSENT ?? 0;
    const counted = present + late + half + absent; // approved leave (EXCUSED) is not counted against the student
    const percent = counted ? Math.round(((present + late + half * 0.5) / counted) * 100) : null;
    if (percent !== null && counted >= MIN_DAYS && percent < settings.percent) {
      reasons.push({ code: "ATTENDANCE", text: `Attendance ${percent}% over the last ${settings.days} days — ${absent} absent${half ? `, ${half} half day${half === 1 ? "" : "s"}` : ""} out of ${counted} marked day${counted === 1 ? "" : "s"}.` });
    }
    const remark = latestRemark.get(id);
    if (remark) reasons.push({ code: "HOMEWORK", text: `${remark.teacher.firstName} ${remark.teacher.lastName} noted on ${formatDate(remark.createdAt)}: homework frequently missing${remark.subject ? ` (${remark.subject.name})` : ""}.` });
    if (!reasons.length) continue;
    rows.push({ studentId: id, student: `${enrollment.student.firstName} ${enrollment.student.lastName}`, admissionNumber: enrollment.student.admissionNumber, sectionId: enrollment.sectionId, section: sectionLabel(enrollment.section), reasons, attendancePercent: percent, supportId: support.get(id) ?? null });
  }
  rows.sort((a, b) => (a.attendancePercent ?? 101) - (b.attendancePercent ?? 101) || a.student.localeCompare(b.student));
  return { rows, settings, rule };
}

/**
 * Class-wise: per section, how many students each signal flags and how many
 * have support open or resolved this session. Counts only — the lists say who.
 */
export async function attentionByClass(ctx: TenantContext) {
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) return [];
  const scope = await scopeSections(ctx, session.id);
  if (scope && !scope.length) return [];
  const [sections, marks, signals, supports] = await Promise.all([
    ctx.db.section.findMany({ where: { academicSessionId: session.id, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } } }),
    needsAttention(ctx),
    attendanceHomeworkSignals(ctx),
    ctx.db.studentSupport.groupBy({ by: ["sectionId", "status"], where: { academicSessionId: session.id, ...(scope ? { sectionId: { in: scope } } : {}) }, _count: { _all: true } }),
  ]);
  const marksBySection = new Map<string, Set<string>>();
  for (const row of marks.rows) marksBySection.set(row.sectionId, (marksBySection.get(row.sectionId) ?? new Set()).add(row.studentId));
  return sections
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((section) => {
      const here = signals.rows.filter((row) => row.sectionId === section.id);
      const open = supports.filter((row) => row.sectionId === section.id && row.status !== "RESOLVED").reduce((sum, row) => sum + row._count._all, 0);
      const resolved = supports.filter((row) => row.sectionId === section.id && row.status === "RESOLVED").reduce((sum, row) => sum + row._count._all, 0);
      return {
        sectionId: section.id,
        section: sectionLabel(section),
        students: section._count.enrollments,
        marks: marksBySection.get(section.id)?.size ?? 0,
        attendance: here.filter((row) => row.reasons.some((reason) => reason.code === "ATTENDANCE")).length,
        homework: here.filter((row) => row.reasons.some((reason) => reason.code === "HOMEWORK")).length,
        supportOpen: open,
        supportResolved: resolved,
      };
    });
}
