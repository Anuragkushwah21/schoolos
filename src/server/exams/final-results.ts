import "server-only";

import { AppError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { type GradingRules, gradeFor, percentage, weightedPercent } from "@/lib/grades";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";
import { gradingRules } from "@/server/exams/grading";
import { findChild } from "@/server/parent/access";
import { findStudentSelf } from "@/server/student/access";

/**
 * The session's final result, made from its exams by the school's weights
 * (`ResultScheme`), e.g. Unit Test 1 10% + Half-Yearly 30% + Annual 60%.
 *
 * Rules, stated once:
 *   * For each subject, each component exam gives a percentage (marks over
 *     that paper's maximum; Absent = 0%; Exempt = not counted). The subject's
 *     final percentage is Σ(weight × percentage) / Σ(weights counted) — never
 *     raw marks added across different maximums.
 *   * The overall final percentage is the same weighting over each exam's
 *     overall percentage.
 *   * Pass: every subject's final percentage at least the school's pass
 *     percentage. Grades come from the school's scale.
 *   * Only PUBLISHED exams count. Families see the final result once every
 *     component exam is published for the class; before that, nothing.
 */

export type SchemeComponent = { examName: string; weight: number };

export function parseComponents(text: string): SchemeComponent[] {
  return text
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s*[:=]\s*(\d+)\s*%?$/);
      if (!match) throw new AppError("VALIDATION", `Write each line as "Exam name: weight", e.g. "Half-Yearly: 30" — not "${line}".`);
      return { examName: match[1]!.trim(), weight: Number(match[2]) };
    });
}

/** Weights whole, 1–100 each, adding to exactly 100; each exam once. */
export function checkComponents(components: SchemeComponent[]): string | null {
  if (components.length < 1 || components.length > 10) return "Use between 1 and 10 exams.";
  if (new Set(components.map((row) => row.examName.toLowerCase())).size !== components.length) return "Each exam can appear once.";
  if (components.some((row) => !Number.isInteger(row.weight) || row.weight < 1 || row.weight > 100)) return "Each weight must be a whole number from 1 to 100.";
  const total = components.reduce((sum, row) => sum + row.weight, 0);
  if (total !== 100) return `The weights add up to ${total}. They must add up to exactly 100.`;
  return null;
}

async function currentSessionId(ctx: TenantContext, academicSessionId?: string | null) {
  const session = await ctx.db.academicSession.findFirst({ where: academicSessionId ? { id: academicSessionId } : { isCurrent: true }, select: { id: true, name: true } });
  if (!session) throw new NotFoundError("Set up an academic session first.");
  return session;
}

export async function getResultScheme(ctx: TenantContext, academicSessionId?: string | null) {
  assertCan(ctx, "exams", "VIEW");
  const session = await currentSessionId(ctx, academicSessionId);
  const [scheme, exams] = await Promise.all([
    ctx.db.resultScheme.findFirst({ where: { academicSessionId: session.id }, select: { id: true, name: true, components: true, updatedAt: true } }),
    ctx.db.exam.findMany({ where: { academicSessionId: session.id }, distinct: ["name"], orderBy: { startDate: "asc" }, select: { name: true } }),
  ]);
  return { session, scheme: scheme ? { ...scheme, components: scheme.components as SchemeComponent[] } : null, examNames: exams.map((row) => row.name) };
}

export async function saveResultScheme(ctx: TenantContext, input: { name: string; components: SchemeComponent[] }) {
  assertCan(ctx, "exams", "EDIT");
  const session = await currentSessionId(ctx);
  const problem = checkComponents(input.components);
  if (problem) throw new AppError("VALIDATION", problem);
  const names = new Set((await ctx.db.exam.findMany({ where: { academicSessionId: session.id }, distinct: ["name"], select: { name: true } })).map((row) => row.name.toLowerCase()));
  const unknown = input.components.find((row) => !names.has(row.examName.toLowerCase()));
  if (unknown) throw new AppError("VALIDATION", `There is no exam called "${unknown.examName}" this session. Create it first, or check the spelling.`);
  const scheme = await ctx.db.resultScheme.upsert({
    where: { schoolId_academicSessionId: { schoolId: ctx.schoolId, academicSessionId: session.id } },
    create: { schoolId: ctx.schoolId, academicSessionId: session.id, name: input.name, components: input.components, createdById: ctx.user.id },
    update: { name: input.name, components: input.components },
    select: { id: true },
  });
  await recordAudit({
    action: "RESULT_SCHEME_SAVED",
    entityType: "ResultScheme",
    entityId: scheme.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Final result "${input.name}" for ${session.name}: ${input.components.map((row) => `${row.examName} ${row.weight}%`).join(" + ")}.`,
    metadata: { components: input.components },
  });
  return scheme;
}

type ExamRow = {
  id: string;
  name: string;
  status: string;
  papers: Array<{ id: string; maxMarks: number; subject: { id: string; name: string }; results: Array<{ studentId: string; marksObtained: number | null; absent: boolean; exempt: boolean }> }>;
};

/** One student's final result from the section's exams (pure, given the rows). */
export function computeFinal(studentId: string, components: SchemeComponent[], exams: ExamRow[], rules: GradingRules) {
  const byName = new Map(exams.map((exam) => [exam.name.toLowerCase(), exam]));
  const subjects = new Map<string, { name: string; parts: Array<{ examName: string; weight: number; percent: number | null }> }>();
  const overallParts: Array<{ percent: number | null; weight: number }> = [];
  const missing: string[] = [];
  for (const component of components) {
    const exam = byName.get(component.examName.toLowerCase());
    if (!exam || exam.status !== "PUBLISHED") {
      missing.push(component.examName);
      continue;
    }
    let obtained = 0;
    let max = 0;
    for (const paper of exam.papers) {
      const result = paper.results.find((row) => row.studentId === studentId) ?? null;
      const entry = subjects.get(paper.subject.id) ?? { name: paper.subject.name, parts: [] };
      let percent: number | null = null;
      if (result && !result.exempt) {
        percent = result.absent ? 0 : result.marksObtained === null ? null : percentage(result.marksObtained, paper.maxMarks);
        if (percent !== null) {
          obtained += result.absent ? 0 : result.marksObtained!;
          max += paper.maxMarks;
        }
      }
      entry.parts.push({ examName: exam.name, weight: component.weight, percent });
      subjects.set(paper.subject.id, entry);
    }
    overallParts.push({ percent: max ? percentage(obtained, max) : null, weight: component.weight });
  }
  const subjectRows = [...subjects.values()]
    .map((entry) => {
      const final = weightedPercent(entry.parts);
      return { subject: entry.name, parts: entry.parts, percent: final, grade: gradeFor(final, rules.bands), passed: final === null ? null : final >= rules.passPercent };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
  const percent = weightedPercent(overallParts);
  const complete = missing.length === 0;
  return {
    complete,
    missing,
    subjects: subjectRows,
    percent,
    grade: gradeFor(percent, rules.bands),
    outcome: !complete ? ("INCOMPLETE" as const) : subjectRows.every((row) => row.passed !== false) && subjectRows.length > 0 ? ("PASS" as const) : ("FAIL" as const),
  };
}

const EXAM_SELECT = {
  id: true,
  name: true,
  status: true,
  papers: { select: { id: true, maxMarks: true, subject: { select: { id: true, name: true } }, results: { select: { studentId: true, marksObtained: true, absent: true, exempt: true } } } },
} as const;

/** The office: every student's final result in a section. */
export async function finalResultsForSection(ctx: TenantContext, sectionId: string) {
  assertCan(ctx, "exams", "VIEW");
  const section = await ctx.db.section.findFirst({ where: { id: sectionId }, select: { id: true, name: true, academicSessionId: true, class: { select: { name: true } }, stream: { select: { name: true } } } });
  if (!section) throw new NotFoundError("That class was not found.");
  const { scheme } = await getResultScheme(ctx, section.academicSessionId);
  if (!scheme) return { section: { id: section.id, label: sectionLabel(section) }, scheme: null, rows: [] };
  const [exams, enrollments, rules] = await Promise.all([
    ctx.db.exam.findMany({ where: { sectionId: section.id, academicSessionId: section.academicSessionId }, select: EXAM_SELECT }),
    ctx.db.studentEnrollment.findMany({ where: { sectionId: section.id, academicSessionId: section.academicSessionId, status: { in: ["ACTIVE", "COMPLETED"] } }, select: { rollNumber: true, student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } } }),
    gradingRules(ctx),
  ]);
  const rows = enrollments
    .map((row) => ({ studentId: row.student.id, name: fullName(row.student), admissionNumber: row.student.admissionNumber, rollNumber: row.rollNumber, ...computeFinal(row.student.id, scheme.components, exams, rules) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { section: { id: section.id, label: sectionLabel(section) }, scheme, rows };
}

/**
 * A student's final result for a family: the student themselves or a linked
 * parent, and only once every component exam is published. Otherwise null.
 */
export async function finalResultFor(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "PRINCIPAL", "PARENT", "STUDENT");
  if (ctx.user.role === "PARENT" && !(await findChild(ctx, studentId).catch(() => null))) throw new NotFoundError();
  if (ctx.user.role === "STUDENT" && (await findStudentSelf(ctx).catch(() => null))?.student.id !== studentId) throw new NotFoundError();
  const enrollment = await ctx.db.studentEnrollment.findFirst({ where: { studentId, academicSession: { isCurrent: true } }, orderBy: { createdAt: "desc" }, select: { sectionId: true, academicSessionId: true } });
  if (!enrollment) return null;
  const scheme = await ctx.db.resultScheme.findFirst({ where: { academicSessionId: enrollment.academicSessionId }, select: { name: true, components: true } });
  if (!scheme) return null;
  const [exams, rules] = await Promise.all([
    ctx.db.exam.findMany({ where: { sectionId: enrollment.sectionId, academicSessionId: enrollment.academicSessionId, status: "PUBLISHED" }, select: EXAM_SELECT }),
    gradingRules(ctx),
  ]);
  const components = scheme.components as SchemeComponent[];
  const result = computeFinal(studentId, components, exams.map((exam) => ({ ...exam, papers: exam.papers.map((paper) => ({ ...paper, results: paper.results.filter((row) => row.studentId === studentId) })) })), rules);
  // Families see it only when it is final.
  if (!result.complete && !["SCHOOL_ADMIN", "PRINCIPAL"].includes(ctx.user.role)) return null;
  return { name: scheme.name, components, ...result };
}
