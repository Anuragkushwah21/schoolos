import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";

/**
 * "Needs Attention" — never a label like "weak", and never from one test
 * alone without saying so. A student needs attention in a subject when:
 *
 *   * LATEST   — their latest result is below the school's threshold;
 *   * REPEATED — at least N of their last three results are below it;
 *   * SUPPORT  — a teacher has open support for them in that subject.
 *
 * Only official marks count: submitted tests and published exams. The
 * threshold (default 40%) and N (default 2) are the School Admin's to set,
 * and every row says which rule it met, in words.
 */

export type AttentionReason = { code: "LATEST" | "REPEATED" | "SUPPORT"; text: string };

export type AttentionRow = {
  studentId: string;
  student: string;
  admissionNumber: string;
  sectionId: string;
  section: string;
  subjectId: string;
  subject: string;
  latestPercent: number | null;
  latestTest: string | null;
  latestDate: Date | null;
  reasons: AttentionReason[];
  supportId: string | null;
};

export async function attentionSettings(ctx: TenantContext) {
  const school = await ctx.db.school.findFirst({ select: { needsAttentionPercent: true, needsAttentionRepeat: true } });
  return { percent: school?.needsAttentionPercent ?? 40, repeat: school?.needsAttentionRepeat ?? 2 };
}

/** The rule in one sentence, shown wherever the indicator appears. */
export function attentionRule(settings: { percent: number; repeat: number }): string {
  return `A subject needs attention when the latest test is below ${settings.percent}%, when ${settings.repeat} of the last 3 tests are below ${settings.percent}%, or when a teacher has opened support for it.`;
}

export async function saveAttentionSettings(ctx: TenantContext, input: { percent: number; repeat: number }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 99) throw new AppError("VALIDATION", "Choose a threshold from 1% to 99%.");
  if (!Number.isInteger(input.repeat) || input.repeat < 1 || input.repeat > 3) throw new AppError("VALIDATION", "Choose 1, 2 or 3 of the last three tests.");
  await ctx.db.school.update({ where: { id: ctx.schoolId }, data: { needsAttentionPercent: input.percent, needsAttentionRepeat: input.repeat } });
  await recordAudit({
    action: "ATTENTION_SETTINGS_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Needs Attention: below ${input.percent}%, or ${input.repeat} of the last 3 tests below it.`,
  });
}

/**
 * Who this user may see attention for. The admin: everyone. A teacher: the
 * subjects they teach in each section, plus every subject for a section they
 * are class teacher of (the overall picture). Others: nobody.
 */
async function scopeWhere(ctx: TenantContext, sessionId: string): Promise<{ results: Prisma.AssessmentWhereInput; support: Prisma.StudentSupportWhereInput } | null> {
  if (ctx.user.role === "SCHOOL_ADMIN") return { results: {}, support: {} };
  if (ctx.user.role !== "TEACHER") return null;
  const teacher = await requireTeacherSelf(ctx);
  const [assignments, classSections] = await Promise.all([
    ctx.db.teacherSubjectAssignment.findMany({ where: { teacherId: teacher.id, academicSessionId: sessionId }, select: { sectionId: true, subjectId: true } }),
    ctx.db.section.findMany({ where: { classTeacherId: teacher.id, academicSessionId: sessionId }, select: { id: true } }),
  ]);
  const pairs = assignments.map((row) => ({ sectionId: row.sectionId, subjectId: row.subjectId }));
  const sections = classSections.map((row) => row.id);
  if (!pairs.length && !sections.length) return { results: { id: { in: [] } }, support: { id: { in: [] } } };
  const or = [...pairs, ...(sections.length ? [{ sectionId: { in: sections } }] : [])];
  return { results: { OR: or }, support: { OR: or } };
}

/**
 * Students needing attention, newest results first. Narrow with
 * `studentIds`, `sectionId` or `subjectId`; the user's own scope always applies.
 */
export async function needsAttention(
  ctx: TenantContext,
  filters: { studentIds?: string[]; sectionId?: string; subjectId?: string } = {},
): Promise<{ rows: AttentionRow[]; settings: { percent: number; repeat: number }; rule: string }> {
  const settings = await attentionSettings(ctx);
  const rule = attentionRule(settings);
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) return { rows: [], settings, rule };
  const scope = await scopeWhere(ctx, session.id);
  if (!scope) return { rows: [], settings, rule };

  const narrow: Prisma.AssessmentWhereInput = {
    academicSessionId: session.id,
    ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
  };
  const [results, supports] = await Promise.all([
    ctx.db.assessmentResult.findMany({
      where: {
        marksObtained: { not: null },
        ...(filters.studentIds ? { studentId: { in: filters.studentIds } } : {}),
        student: { status: "ACTIVE" },
        assessment: { AND: [narrow, scope.results, { OR: [{ marksStatus: "SUBMITTED" }, { exam: { status: "PUBLISHED" } }] }] },
      },
      take: 20000,
      select: {
        marksObtained: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
        assessment: {
          select: {
            name: true,
            date: true,
            createdAt: true,
            maxMarks: true,
            sectionId: true,
            subject: { select: { id: true, name: true } },
            section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
            exam: { select: { name: true } },
          },
        },
      },
    }),
    ctx.db.studentSupport.findMany({
      where: {
        academicSessionId: session.id,
        status: { not: "RESOLVED" },
        subjectId: filters.subjectId ?? { not: null },
        ...(filters.studentIds ? { studentId: { in: filters.studentIds } } : {}),
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
        ...scope.support,
      },
      select: {
        id: true,
        reason: true,
        studentId: true,
        sectionId: true,
        subject: { select: { id: true, name: true } },
        student: { select: { firstName: true, lastName: true, admissionNumber: true } },
        section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
      },
    }),
  ]);

  type Group = Omit<AttentionRow, "reasons" | "latestPercent" | "latestTest" | "latestDate" | "supportId"> & { points: Array<{ percent: number; test: string; date: Date; created: Date }> };
  const groups = new Map<string, Group>();
  for (const row of results) {
    const subject = row.assessment.subject;
    const key = `${row.student.id}|${subject.id}`;
    const group = groups.get(key) ?? {
      studentId: row.student.id,
      student: fullName(row.student),
      admissionNumber: row.student.admissionNumber,
      sectionId: row.assessment.sectionId,
      section: sectionLabel(row.assessment.section),
      subjectId: subject.id,
      subject: subject.name,
      points: [],
    };
    const percent = row.assessment.maxMarks ? Math.round(((row.marksObtained ?? 0) / row.assessment.maxMarks) * 1000) / 10 : 0;
    group.points.push({ percent, test: row.assessment.exam ? `${row.assessment.exam.name}` : row.assessment.name, date: row.assessment.date, created: row.assessment.createdAt });
    groups.set(key, group);
  }

  const supportByKey = new Map(supports.map((row) => [`${row.studentId}|${row.subject!.id}`, row]));
  const rows: AttentionRow[] = [];
  const seen = new Set<string>();
  for (const [key, group] of groups) {
    seen.add(key);
    // Newest first; two tests on one day are ordered by when they were set.
    const points = group.points.sort((a, b) => b.date.getTime() - a.date.getTime() || b.created.getTime() - a.created.getTime());
    const latest = points[0]!;
    const recent = points.slice(0, 3);
    const below = recent.filter((point) => point.percent < settings.percent).length;
    const reasons: AttentionReason[] = [];
    if (latest.percent < settings.percent) reasons.push({ code: "LATEST", text: `Latest test ${latest.percent}% — below the ${settings.percent}% threshold` });
    if (recent.length >= settings.repeat && below >= settings.repeat && settings.repeat > 1) {
      reasons.push({ code: "REPEATED", text: `${below} of the last ${recent.length} tests below ${settings.percent}%` });
    }
    const support = supportByKey.get(key);
    if (support) reasons.push({ code: "SUPPORT", text: "Teacher support open" });
    if (!reasons.length) continue;
    const { points: _points, ...rest } = group;
    void _points;
    rows.push({ ...rest, latestPercent: latest.percent, latestTest: latest.test, latestDate: latest.date, reasons, supportId: support?.id ?? null });
  }
  // Support with no official marks yet still counts — a teacher's observation.
  for (const support of supports) {
    const key = `${support.studentId}|${support.subject!.id}`;
    if (seen.has(key)) continue;
    rows.push({
      studentId: support.studentId,
      student: fullName(support.student),
      admissionNumber: support.student.admissionNumber,
      sectionId: support.sectionId,
      section: sectionLabel(support.section),
      subjectId: support.subject!.id,
      subject: support.subject!.name,
      latestPercent: null,
      latestTest: null,
      latestDate: null,
      reasons: [{ code: "SUPPORT", text: "Teacher support open (teacher's observation)" }],
      supportId: support.id,
    });
  }
  rows.sort((a, b) => (a.latestPercent ?? 101) - (b.latestPercent ?? 101) || a.student.localeCompare(b.student));
  return { rows, settings, rule };
}

/** How many distinct students need attention — the dashboard figure. */
export async function needsAttentionCount(ctx: TenantContext): Promise<number> {
  const { rows } = await needsAttention(ctx);
  return new Set(rows.map((row) => row.studentId)).size;
}
