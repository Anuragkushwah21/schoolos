import "server-only";

import { type ExamProgress, examStage, publishBlocker } from "@/lib/exam-stage";

import type { Prisma } from "@/generated/prisma/client";
import type { ExamStatus } from "@/generated/prisma/enums";
import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { formatDate, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { examOutcome, gradeFor, paperOutcome, type PaperOutcome, passMarkFor, percentage } from "@/lib/grades";
import { spanStatus } from "@/lib/time-status";
import type { ClassTestInput, CreateExamInput, MarkEntry, UpdateExamInput } from "@/lib/validation/exams";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireSubjectAssignment, requireTeacherSelf } from "@/server/auth/teacher-access";

/**
 * Exams, class tests and marks.
 *
 * One marks table for both: every paper is an `Assessment` and every mark an
 * `AssessmentResult`. An exam groups a section's papers for one term, adds
 * pass marks and a publish switch, and produces a report card. A class test
 * is an `Assessment` with no exam, set by its own teacher, and its marks are
 * visible as soon as they are entered — as they always have been.
 *
 * Who does what:
 *   * School Admin — creates, edits and deletes exams, enters or corrects any
 *     marks, publishes and unpublishes results.
 *   * Teacher — enters marks only for papers of a subject they are assigned to
 *     teach that section (`requireSubjectAssignment`), and sets class tests the
 *     same way. Nothing else.
 *   * Student / Parent — read published results only (see `results.ts`).
 *
 * Marks cannot change once an exam is published: the admin unpublishes first,
 * which is recorded, so a published report card never shifts silently.
 */

/** Papers whose results students and parents may see. */
export const VISIBLE_PAPER: Prisma.AssessmentWhereInput = {
  OR: [{ examId: null }, { exam: { status: "PUBLISHED" } }],
};

const SECTION_LABEL_SELECT = {
  name: true,
  class: { select: { name: true } },
  stream: { select: { name: true } },
} as const;

// -----------------------------------------------------------------------------
// Exams (School Admin)
// -----------------------------------------------------------------------------

/**
 * Create one exam for one or more sections, with the same papers in each.
 * All or nothing: if any section already has an exam of that name, none is
 * created.
 */
export async function createExams(ctx: TenantContext, input: CreateExamInput): Promise<{ ids: string[] }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);

  const sectionIds = [...new Set(input.sectionIds)];
  const subjectIds = input.papers.map((paper) => paper.subjectId);

  const [sections, subjects, clashes, assignments] = await Promise.all([
    ctx.db.section.findMany({
      where: { id: { in: sectionIds }, academicSessionId: session.id },
      select: { id: true, ...SECTION_LABEL_SELECT },
    }),
    ctx.db.subject.findMany({ where: { id: { in: subjectIds }, isActive: true }, select: { id: true, name: true } }),
    ctx.db.exam.findMany({
      where: { academicSessionId: session.id, sectionId: { in: sectionIds }, name: input.name },
      select: { section: { select: SECTION_LABEL_SELECT } },
    }),
    ctx.db.teacherSubjectAssignment.findMany({
      where: { academicSessionId: session.id, sectionId: { in: sectionIds }, subjectId: { in: subjectIds } },
      orderBy: { createdAt: "asc" },
      select: { sectionId: true, subjectId: true, teacherId: true },
    }),
  ]);
  // Another school's section or subject resolves to nothing here.
  if (sections.length !== sectionIds.length) throw new NotFoundError("A chosen section was not found in this session.");
  if (subjects.length !== new Set(subjectIds).size) throw new NotFoundError("A chosen subject was not found.");
  if (clashes.length) {
    throw new ConflictError(
      `"${input.name}" already exists for ${clashes.map((clash) => sectionLabel(clash.section)).join(", ")}.`,
    );
  }

  const teacherFor = new Map<string, string>();
  for (const row of assignments) {
    const key = `${row.sectionId}:${row.subjectId}`;
    if (!teacherFor.has(key)) teacherFor.set(key, row.teacherId);
  }

  const ids = await ctx.db.$transaction(async (tx) => {
    const created: string[] = [];
    for (const section of sections) {
      const exam = await tx.exam.create({
        data: {
          schoolId: ctx.schoolId,
          academicSessionId: session.id,
          sectionId: section.id,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
        },
        select: { id: true },
      });
      await tx.assessment.createMany({
        data: input.papers.map((paper) => ({
          schoolId: ctx.schoolId,
          academicSessionId: session.id,
          sectionId: section.id,
          subjectId: paper.subjectId,
          teacherId: teacherFor.get(`${section.id}:${paper.subjectId}`) ?? null,
          examId: exam.id,
          name: input.name,
          date: paper.date ?? input.startDate,
          maxMarks: paper.maxMarks,
          passMarks: paper.passMarks ?? null,
        })),
      });
      created.push(exam.id);
    }
    return created;
  });

  await recordAudit({
    action: "EXAM_CREATED",
    entityType: "Exam",
    entityId: ids[0] ?? null,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Exam "${input.name}" (${input.papers.length} papers) created for ${sections.map(sectionLabel).join(", ")}.`,
    metadata: { examIds: ids },
  });

  return { ids };
}

async function requireExam(ctx: TenantContext, examId: string) {
  const exam = await ctx.db.exam.findFirst({
    where: { id: examId },
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      publishedAt: true,
      sectionId: true,
      academicSessionId: true,
      academicSession: { select: { name: true } },
      section: { select: SECTION_LABEL_SELECT },
    },
  });
  if (!exam) throw new NotFoundError("That exam was not found.");
  return exam;
}

function assertDraft(exam: { status: ExamStatus; name: string }): void {
  if (exam.status === "PUBLISHED") {
    throw new AppError("VALIDATION", `Results for "${exam.name}" are published. Unpublish them first to make changes.`);
  }
}

export async function updateExam(ctx: TenantContext, input: UpdateExamInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const exam = await requireExam(ctx, input.examId);
  assertDraft(exam);

  const outside = await ctx.db.assessment.count({
    where: { examId: exam.id, OR: [{ date: { lt: input.startDate } }, { date: { gt: input.endDate } }] },
  });
  if (outside) {
    throw new ValidationError("Please correct the highlighted fields.", {
      endDate: [`${outside} paper${outside > 1 ? "s are" : " is"} dated outside these dates. Move them first.`],
    });
  }

  if (input.name !== exam.name) {
    const clash = await ctx.db.exam.count({
      where: { academicSessionId: exam.academicSessionId, sectionId: exam.sectionId, name: input.name, NOT: { id: exam.id } },
    });
    if (clash) throw new ConflictError(`"${input.name}" already exists for ${sectionLabel(exam.section)}.`);
  }

  await ctx.db.$transaction([
    ctx.db.exam.updateMany({
      where: { id: exam.id },
      data: { name: input.name, startDate: input.startDate, endDate: input.endDate },
    }),
    ctx.db.assessment.updateMany({ where: { examId: exam.id }, data: { name: input.name } }),
  ]);

  await recordAudit({
    action: "EXAM_UPDATED",
    entityType: "Exam",
    entityId: exam.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Exam "${exam.name}" for ${sectionLabel(exam.section)} updated.`,
  });
}

/** A draft exam, its papers and any marks already entered. Published exams cannot be deleted. */
export async function deleteExam(ctx: TenantContext, examId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const exam = await requireExam(ctx, examId);
  assertDraft(exam);

  const papers = await ctx.db.assessment.findMany({ where: { examId: exam.id }, select: { id: true } });
  await ctx.db.$transaction([
    ctx.db.assessmentResult.deleteMany({ where: { assessmentId: { in: papers.map((paper) => paper.id) } } }),
    ctx.db.assessment.deleteMany({ where: { examId: exam.id } }),
    ctx.db.exam.deleteMany({ where: { id: exam.id } }),
  ]);

  await recordAudit({
    action: "EXAM_DELETED",
    entityType: "Exam",
    entityId: exam.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Draft exam "${exam.name}" for ${sectionLabel(exam.section)} deleted.`,
  });
}

/** Active students of a section in a session, in roll order. */
async function sectionRoster(ctx: TenantContext, sectionId: string, academicSessionId: string) {
  const rows = await ctx.db.studentEnrollment.findMany({
    where: { sectionId, academicSessionId, status: "ACTIVE", student: { status: "ACTIVE" } },
    select: {
      rollNumber: true,
      student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
    },
  });
  const rollOrder = (roll: string | null) => (roll && /^\d+$/.test(roll) ? Number(roll) : Number.MAX_SAFE_INTEGER);
  return rows
    .sort((a, b) => rollOrder(a.rollNumber) - rollOrder(b.rollNumber) || a.student.firstName.localeCompare(b.student.firstName))
    .map((row) => ({
      studentId: row.student.id,
      name: fullName(row.student),
      admissionNumber: row.student.admissionNumber,
      rollNumber: row.rollNumber,
    }));
}

type PaperRow = {
  id: string;
  subjectId: string;
  subject: string;
  maxMarks: number;
  passMarks: number | null;
  date: Date;
  teacher: string | null;
};

/**
 * Every student's standing in an exam: per-paper outcome, total, percentage,
 * grade and overall result. Absent papers count as zero in the total.
 */
export function tabulate(
  papers: PaperRow[],
  roster: Array<{ studentId: string; name: string; admissionNumber: string; rollNumber: string | null }>,
  results: Array<{ assessmentId: string; studentId: string; marksObtained: number | null; absent: boolean; remarks: string | null }>,
) {
  const byKey = new Map(results.map((row) => [`${row.assessmentId}:${row.studentId}`, row]));
  const maxTotal = papers.reduce((sum, paper) => sum + paper.maxMarks, 0);

  return roster.map((student) => {
    const outcomes: PaperOutcome[] = [];
    let obtained = 0;
    const marks = papers.map((paper) => {
      const result = byKey.get(`${paper.id}:${student.studentId}`) ?? null;
      const outcome = paperOutcome(paper, result);
      outcomes.push(outcome);
      if (result?.marksObtained) obtained += result.marksObtained;
      const percent = result?.marksObtained !== null && result?.marksObtained !== undefined ? percentage(result.marksObtained, paper.maxMarks) : null;
      return {
        assessmentId: paper.id,
        marksObtained: result?.marksObtained ?? null,
        absent: result?.absent ?? false,
        remark: result?.remarks ?? null,
        grade: result?.absent ? null : gradeFor(percent),
        outcome,
      };
    });
    const complete = !outcomes.includes("PENDING");
    const percent = complete ? percentage(obtained, maxTotal) : null;
    return {
      ...student,
      marks,
      total: obtained,
      maxTotal,
      percent,
      grade: gradeFor(percent),
      outcome: examOutcome(outcomes),
      entered: outcomes.filter((outcome) => outcome !== "PENDING").length,
    };
  });
}

async function examPapers(ctx: TenantContext, examId: string): Promise<PaperRow[]> {
  const rows = await ctx.db.assessment.findMany({
    where: { examId },
    orderBy: [{ date: "asc" }, { subject: { name: "asc" } }],
    select: {
      id: true,
      maxMarks: true,
      passMarks: true,
      date: true,
      subject: { select: { id: true, name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    subjectId: row.subject.id,
    subject: row.subject.name,
    maxMarks: row.maxMarks,
    passMarks: row.passMarks,
    date: row.date,
    teacher: row.teacher ? fullName(row.teacher) : null,
  }));
}

/** The exam with its papers and every student's tabulated result. School Admin. */
export async function getExamDetail(ctx: TenantContext, examId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const exam = await requireExam(ctx, examId);
  const [papers, roster] = await Promise.all([
    examPapers(ctx, exam.id),
    sectionRoster(ctx, exam.sectionId, exam.academicSessionId),
  ]);
  const results = await ctx.db.assessmentResult.findMany({
    where: { assessmentId: { in: papers.map((paper) => paper.id) } },
    select: { assessmentId: true, studentId: true, marksObtained: true, absent: true, remarks: true },
  });
  const students = tabulate(papers, roster, results);
  const enteredBy = new Map<string, number>();
  for (const row of results) {
    if (row.marksObtained !== null || row.absent) enteredBy.set(row.assessmentId, (enteredBy.get(row.assessmentId) ?? 0) + 1);
  }
  const now = today();
  const rows = papers.map((paper) => ({ ...paper, held: paper.date <= now, entered: enteredBy.get(paper.id) ?? 0, expected: roster.length }));
  const progress: ExamProgress = {
    published: exam.status === "PUBLISHED",
    papers: rows.length,
    notHeld: rows.filter((paper) => !paper.held).length,
    entered: rows.reduce((sum, paper) => sum + Math.min(paper.entered, paper.expected), 0),
    expected: rows.reduce((sum, paper) => sum + paper.expected, 0),
  };
  return {
    exam: { ...exam, sectionLabel: sectionLabel(exam.section), timeStatus: spanStatus(exam.startDate, exam.endDate, now) },
    papers: rows,
    students,
    stage: examStage(progress),
    blocker: publishBlocker(progress),
  };
}

export async function listExams(
  ctx: TenantContext,
  filters: { academicSessionId?: string; sectionId?: string; status?: ExamStatus } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const sessionId =
    filters.academicSessionId ??
    (await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id;
  if (!sessionId) return [];

  const exams = await ctx.db.exam.findMany({
    where: {
      academicSessionId: sessionId,
      ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: [{ startDate: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      sectionId: true,
      section: { select: { ...SECTION_LABEL_SELECT, class: { select: { name: true, level: true } } } },
      papers: {
        select: {
          id: true,
          date: true,
          _count: { select: { results: { where: { OR: [{ marksObtained: { not: null } }, { absent: true }] } } } },
        },
      },
    },
  });

  const counts = await ctx.db.studentEnrollment.groupBy({
    by: ["sectionId"],
    where: {
      academicSessionId: sessionId,
      sectionId: { in: [...new Set(exams.map((exam) => exam.sectionId))] },
      status: "ACTIVE",
      student: { status: "ACTIVE" },
    },
    _count: { _all: true },
  });
  const studentsIn = new Map(counts.map((row) => [row.sectionId, row._count._all]));

  return exams
    .map((exam) => {
      const students = studentsIn.get(exam.sectionId) ?? 0;
      const entered = exam.papers.reduce((sum, paper) => sum + Math.min(paper._count.results, students), 0);
      const now = today();
      const progress: ExamProgress = {
        published: exam.status === "PUBLISHED",
        papers: exam.papers.length,
        notHeld: exam.papers.filter((paper) => paper.date > now).length,
        entered,
        expected: exam.papers.length * students,
      };
      return {
        id: exam.id,
        name: exam.name,
        status: exam.status,
        startDate: exam.startDate,
        endDate: exam.endDate,
        section: sectionLabel(exam.section),
        level: exam.section.class.level,
        /** UPCOMING, ONGOING or COMPLETED — from the exam's dates, never stored. */
        timeStatus: spanStatus(exam.startDate, exam.endDate),
        papers: exam.papers.length,
        entered,
        expected: exam.papers.length * students,
        /** DRAFT → IN_PROGRESS → MARKS_PENDING → READY_TO_PUBLISH → PUBLISHED, from the marks. */
        stage: examStage(progress),
      };
    })
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime() || a.level - b.level || a.section.localeCompare(b.section));
}

/**
 * Publish results. Refused for any exam with marks still missing, and then
 * for none of them: a report card with blank subjects is not a result.
 */
export async function publishExams(ctx: TenantContext, examIds: string[]): Promise<{ published: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const unique = [...new Set(examIds)];
  const exams = await ctx.db.exam.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, status: true, sectionId: true, academicSessionId: true, section: { select: SECTION_LABEL_SELECT } },
  });
  if (exams.length !== unique.length) throw new NotFoundError("An exam was not found.");

  const incomplete: Array<{ label: string; headline: string; detail: string; action: "papers" | "marks" }> = [];
  for (const exam of exams) {
    if (exam.status === "PUBLISHED") continue;
    const [papers, roster] = await Promise.all([
      ctx.db.assessment.findMany({ where: { examId: exam.id }, select: { id: true } }),
      sectionRoster(ctx, exam.sectionId, exam.academicSessionId),
    ]);
    const entered = await ctx.db.assessmentResult.count({
      where: {
        assessmentId: { in: papers.map((paper) => paper.id) },
        studentId: { in: roster.map((row) => row.studentId) },
        OR: [{ marksObtained: { not: null } }, { absent: true }],
      },
    });
    const notHeld = await ctx.db.assessment.count({ where: { examId: exam.id, date: { gt: today() } } });
    const blocker = publishBlocker({ published: false, papers: papers.length, notHeld, entered, expected: papers.length * roster.length });
    if (blocker) incomplete.push({ label: sectionLabel(exam.section), ...blocker });
  }
  if (incomplete.length) {
    // Say what is wrong, then what to do — in the words the exam page uses.
    const first = incomplete[0]!;
    throw new AppError(
      "VALIDATION",
      incomplete.length === 1
        ? `${first.headline} ${first.detail} Open the exam to see ${first.action === "papers" ? "the pending papers" : "the missing marks"}.`
        : `Results can't be published yet for ${incomplete.length} exams: ${incomplete.map((row) => `${row.label} (${row.detail.replace(/\.$/, "")})`).join("; ")}. Nothing was published.`,
    );
  }

  const toPublish = exams.filter((exam) => exam.status !== "PUBLISHED");
  await ctx.db.exam.updateMany({
    where: { id: { in: toPublish.map((exam) => exam.id) } },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  for (const exam of toPublish) {
    await recordAudit({
      action: "RESULTS_PUBLISHED",
      entityType: "Exam",
      entityId: exam.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Results of "${exam.name}" published for ${sectionLabel(exam.section)}.`,
    });
  }
  return { published: toPublish.length };
}

export async function unpublishExam(ctx: TenantContext, examId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const exam = await requireExam(ctx, examId);
  if (exam.status !== "PUBLISHED") return;
  await ctx.db.exam.updateMany({ where: { id: exam.id }, data: { status: "DRAFT", publishedAt: null } });
  await recordAudit({
    action: "RESULTS_UNPUBLISHED",
    entityType: "Exam",
    entityId: exam.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Results of "${exam.name}" for ${sectionLabel(exam.section)} withdrawn for correction.`,
  });
}

// -----------------------------------------------------------------------------
// Papers and marks (School Admin and the subject's teacher)
// -----------------------------------------------------------------------------

/**
 * A paper this user may enter marks for, or a refusal. The admin may reach
 * any of their school's papers; a teacher only a paper of a subject they teach
 * that section this session — or a class test they set themselves.
 */
async function requirePaper(ctx: TenantContext, assessmentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "TEACHER");
  const paper = await ctx.db.assessment.findFirst({
    where: { id: assessmentId },
    select: {
      id: true,
      name: true,
      date: true,
      maxMarks: true,
      passMarks: true,
      sectionId: true,
      subjectId: true,
      academicSessionId: true,
      teacherId: true,
      subject: { select: { name: true } },
      section: { select: SECTION_LABEL_SELECT },
      exam: { select: { id: true, name: true, status: true } },
    },
  });
  if (!paper) throw new NotFoundError("That paper was not found.");

  if (ctx.user.role === "TEACHER") {
    const me = await requireTeacherSelf(ctx);
    if (paper.teacherId !== me.id || paper.exam) {
      await requireSubjectAssignment(ctx, paper.sectionId, paper.subjectId, paper.academicSessionId);
    }
  }
  return paper;
}

export async function getMarksSheet(ctx: TenantContext, assessmentId: string) {
  const paper = await requirePaper(ctx, assessmentId);
  const [roster, results] = await Promise.all([
    sectionRoster(ctx, paper.sectionId, paper.academicSessionId),
    ctx.db.assessmentResult.findMany({
      where: { assessmentId: paper.id },
      select: { studentId: true, marksObtained: true, absent: true, remarks: true },
    }),
  ]);
  const byStudent = new Map(results.map((row) => [row.studentId, row]));
  const passMark = passMarkFor(paper.maxMarks, paper.passMarks);

  return {
    paper: {
      id: paper.id,
      name: paper.name,
      subject: paper.subject.name,
      section: sectionLabel(paper.section),
      date: paper.date,
      maxMarks: paper.maxMarks,
      passMarks: passMark,
      exam: paper.exam,
    },
    /** Marks open on the paper's date and close when results are published. */
    editable: paper.exam?.status !== "PUBLISHED" && paper.date <= today(),
    held: paper.date <= today(),
    rows: roster.map((student) => {
      const result = byStudent.get(student.studentId) ?? null;
      return {
        ...student,
        marksObtained: result?.marksObtained ?? null,
        absent: result?.absent ?? false,
        remark: result?.remarks ?? null,
        outcome: paperOutcome(paper, result),
      };
    }),
  };
}

/**
 * Save marks for a paper. Every row is checked before anything is written; one
 * bad row refuses the whole save, with a message against that row.
 *
 * A row with no mark, not absent and no remark clears any mark stored for it.
 */
export async function saveMarks(
  ctx: TenantContext,
  assessmentId: string,
  entries: MarkEntry[],
): Promise<{ saved: number; cleared: number }> {
  const paper = await requirePaper(ctx, assessmentId);
  if (paper.exam?.status === "PUBLISHED") {
    throw new AppError("VALIDATION", "These results are published. The school office must unpublish them before marks can change.");
  }
  if (paper.date > today()) {
    throw new AppError("VALIDATION", `This paper is on ${formatDate(paper.date)}. Marks can be entered from that day.`);
  }
  if (!entries.length) throw new ValidationError("Enter at least one mark.");

  const roster = new Set((await sectionRoster(ctx, paper.sectionId, paper.academicSessionId)).map((row) => row.studentId));
  const errors: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `marks:${entry.studentId}`;
    if (!roster.has(entry.studentId)) {
      // Another section's child, or another school's: refused either way.
      throw new NotFoundError("A student in these marks is not in this class.");
    }
    if (seen.has(entry.studentId)) (errors[key] ??= []).push("This student appears twice.");
    seen.add(entry.studentId);
    if (entry.absent && entry.marks !== null) (errors[key] ??= []).push("An absent student cannot have marks.");
    if (entry.marks !== null && (!Number.isInteger(entry.marks) || entry.marks < 0 || entry.marks > paper.maxMarks)) {
      (errors[key] ??= []).push(`Marks must be a whole number from 0 to ${paper.maxMarks}.`);
    }
    if (entry.remark && entry.remark.length > 300) (errors[key] ??= []).push("Keep the remark under 300 characters.");
  }
  if (Object.keys(errors).length) throw new ValidationError("Some marks need correcting.", errors);

  const toClear = entries.filter((entry) => entry.marks === null && !entry.absent && !entry.remark);
  const toSave = entries.filter((entry) => !toClear.includes(entry));

  await ctx.db.$transaction([
    ...(toClear.length
      ? [ctx.db.assessmentResult.deleteMany({ where: { assessmentId: paper.id, studentId: { in: toClear.map((e) => e.studentId) } } })]
      : []),
    ...toSave.map((entry) =>
      ctx.db.assessmentResult.upsert({
        where: { schoolId_assessmentId_studentId: { schoolId: ctx.schoolId, assessmentId: paper.id, studentId: entry.studentId } },
        create: {
          schoolId: ctx.schoolId,
          assessmentId: paper.id,
          studentId: entry.studentId,
          marksObtained: entry.absent ? null : entry.marks,
          absent: entry.absent,
          remarks: entry.remark,
        },
        update: { marksObtained: entry.absent ? null : entry.marks, absent: entry.absent, remarks: entry.remark },
      }),
    ),
  ]);

  await recordAudit({
    action: "MARKS_UPDATED",
    entityType: "Assessment",
    entityId: paper.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    // Counts only: the marks themselves are the student's, not the log's.
    summary: `Marks for ${paper.subject.name} — ${paper.name} (${sectionLabel(paper.section)}): ${toSave.length} saved${toClear.length ? `, ${toClear.length} cleared` : ""}.`,
  });

  return { saved: toSave.length, cleared: toClear.length };
}

/** The sheet as CSV rows: a blank template before marking, an export after. */
export async function marksCsvTable(ctx: TenantContext, assessmentId: string) {
  const sheet = await getMarksSheet(ctx, assessmentId);
  return {
    filename: `marks-${sheet.paper.section}-${sheet.paper.subject}-${sheet.paper.name}.csv`,
    table: {
      head: ["Admission no.", "Roll no.", "Student", `Marks (out of ${sheet.paper.maxMarks})`, "Absent", "Remark"],
      rows: sheet.rows.map((row) => [
        row.admissionNumber,
        row.rollNumber ?? "",
        row.name,
        row.marksObtained ?? "",
        row.absent ? "Yes" : "",
        row.remark ?? "",
      ]),
    },
  };
}

export type ImportError = { line: number; message: string };

/**
 * Import marks from the CSV template. Nothing is saved unless every row is
 * valid; otherwise the row-by-row errors come back for the user to fix.
 */
export async function importMarksCsv(
  ctx: TenantContext,
  assessmentId: string,
  text: string,
): Promise<{ saved: number; cleared: number; errors: ImportError[] }> {
  const sheet = await getMarksSheet(ctx, assessmentId);
  if (!sheet.editable) {
    throw new AppError(
      "VALIDATION",
      sheet.held
        ? "These results are published. The school office must unpublish them before marks can change."
        : `This paper is on ${formatDate(sheet.paper.date)}. Marks can be entered from that day.`,
    );
  }

  let records;
  try {
    records = readCsvRecords(text, { required: ["Admission no."], maxRows: 500 });
  } catch (error) {
    if (error instanceof CsvFormatError) return { saved: 0, cleared: 0, errors: [{ line: 1, message: error.message }] };
    throw error;
  }
  // The template's header is "Marks (out of 50)"; any column starting "Marks" will do.
  const marksKey = Object.keys(records[0]?.values ?? {}).find((key) => key.startsWith("marks"));
  if (records.length && !marksKey) return { saved: 0, cleared: 0, errors: [{ line: 1, message: "Missing column: Marks." }] };

  const byAdmission = new Map(sheet.rows.map((row) => [row.admissionNumber.toLowerCase(), row.studentId]));
  const errors: ImportError[] = [];
  const entries: MarkEntry[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const admission = record.values["admission no"] ?? "";
    const studentId = byAdmission.get(admission.toLowerCase());
    if (!studentId) {
      errors.push({ line: record.line, message: `Admission no. "${admission}" is not in ${sheet.paper.section}.` });
      continue;
    }
    if (seen.has(studentId)) {
      errors.push({ line: record.line, message: `Admission no. "${admission}" appears more than once.` });
      continue;
    }
    seen.add(studentId);

    const rawMarks = record.values[marksKey!] ?? "";
    const absent = /^(y|yes|true|1|ab|absent)$/i.test(record.values["absent"] ?? "") || /^(ab|absent)$/i.test(rawMarks);
    let marks: number | null = null;
    if (rawMarks !== "" && !/^(ab|absent)$/i.test(rawMarks)) {
      if (!/^\d+$/.test(rawMarks)) {
        errors.push({ line: record.line, message: `"${rawMarks}" is not a whole number.` });
        continue;
      }
      marks = Number(rawMarks);
      if (marks > sheet.paper.maxMarks) {
        errors.push({ line: record.line, message: `${marks} is more than the maximum of ${sheet.paper.maxMarks}.` });
        continue;
      }
    }
    if (absent && marks !== null) {
      errors.push({ line: record.line, message: "Marked absent but also given marks." });
      continue;
    }
    const remark = (record.values["remark"] ?? "").slice(0, 300) || null;
    entries.push({ studentId, marks, absent, remark });
  }

  if (errors.length) return { saved: 0, cleared: 0, errors };
  if (!entries.length) return { saved: 0, cleared: 0, errors: [{ line: 1, message: "The file has no rows." }] };
  const result = await saveMarks(ctx, assessmentId, entries);
  return { ...result, errors: [] };
}

// -----------------------------------------------------------------------------
// Teachers
// -----------------------------------------------------------------------------

/** A class test the teacher sets for a subject they teach. Visible once marked. */
export async function createClassTest(ctx: TenantContext, input: ClassTestInput): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);
  const { teacherId } = await requireSubjectAssignment(ctx, input.sectionId, input.subjectId, session.id);

  const created = await ctx.db.assessment.create({
    data: {
      schoolId: ctx.schoolId,
      academicSessionId: session.id,
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      teacherId,
      name: input.name,
      date: input.date,
      maxMarks: input.maxMarks,
      passMarks: input.passMarks ?? null,
    },
    select: { id: true, subject: { select: { name: true } }, section: { select: SECTION_LABEL_SELECT } },
  });

  await recordAudit({
    action: "CLASS_TEST_CREATED",
    entityType: "Assessment",
    entityId: created.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${created.subject.name} test "${input.name}" set for ${sectionLabel(created.section)} on ${formatDate(input.date)}.`,
  });
  return { id: created.id };
}

/** Every paper this teacher enters marks for this session — exam papers and class tests. */
export async function listMyPapers(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);

  const assignments = await ctx.db.teacherSubjectAssignment.findMany({
    where: { teacherId: teacher.id, academicSessionId: session.id },
    select: {
      sectionId: true,
      subjectId: true,
      section: { select: SECTION_LABEL_SELECT },
      subject: { select: { name: true } },
    },
  });
  if (!assignments.length) return { papers: [], assignments: [] as Array<{ sectionId: string; subjectId: string; label: string }> };

  const papers = await ctx.db.assessment.findMany({
    where: {
      academicSessionId: session.id,
      OR: assignments.map((row) => ({ sectionId: row.sectionId, subjectId: row.subjectId })),
    },
    orderBy: [{ date: "desc" }],
    select: {
      id: true,
      name: true,
      date: true,
      maxMarks: true,
      sectionId: true,
      subject: { select: { name: true } },
      section: { select: SECTION_LABEL_SELECT },
      exam: { select: { name: true, status: true } },
      _count: { select: { results: { where: { OR: [{ marksObtained: { not: null } }, { absent: true }] } } } },
    },
  });

  const counts = await ctx.db.studentEnrollment.groupBy({
    by: ["sectionId"],
    where: {
      academicSessionId: session.id,
      sectionId: { in: [...new Set(assignments.map((row) => row.sectionId))] },
      status: "ACTIVE",
      student: { status: "ACTIVE" },
    },
    _count: { _all: true },
  });
  const studentsIn = new Map(counts.map((row) => [row.sectionId, row._count._all]));

  return {
    papers: papers.map((paper) => ({
      id: paper.id,
      name: paper.name,
      date: paper.date,
      maxMarks: paper.maxMarks,
      subject: paper.subject.name,
      section: sectionLabel(paper.section),
      kind: paper.exam ? ("EXAM" as const) : ("CLASS_TEST" as const),
      held: paper.date <= today(),
      published: paper.exam?.status === "PUBLISHED",
      entered: paper._count.results,
      expected: studentsIn.get(paper.sectionId) ?? 0,
    })),
    assignments: assignments.map((row) => ({
      sectionId: row.sectionId,
      subjectId: row.subjectId,
      label: `${sectionLabel(row.section)} · ${row.subject.name}`,
    })),
  };
}
