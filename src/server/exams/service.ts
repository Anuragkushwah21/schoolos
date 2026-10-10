import "server-only";

import { type ExamProgress, examStage, publishBlocker } from "@/lib/exam-stage";

import type { Prisma } from "@/generated/prisma/client";
import type { ExamStatus } from "@/generated/prisma/enums";
import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { formatDate, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { DEFAULT_RULES, examOutcome, gradeFor, type GradingRules, isEntered, paperOutcome, type PaperOutcome, passMarkFor, percentage } from "@/lib/grades";
import { spanStatus } from "@/lib/time-status";
import type { ClassTestInput, CreateExamInput, MarkEntry, UpdateClassTestInput, UpdateExamInput } from "@/lib/validation/exams";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireStreamTeaching } from "@/server/academics/stream-scope";
import { requireSubjectAssignment, requireTeacherSelf } from "@/server/auth/teacher-access";
import { assertCan } from "@/server/auth/permissions";
import { gradingRules } from "@/server/exams/grading";
import { isSchoolLeader } from "@/lib/permissions";

/**
 * Exams, class tests and marks.
 *
 * One marks table for both: every paper is an `Assessment` and every mark an
 * `AssessmentResult`. An exam groups a section's papers for one term, adds
 * pass marks and a publish switch, and produces a report card. A class test
 * ("test" on screen) is an `Assessment` with no exam, set by its own teacher
 * for a subject, section — and stream, where the section is shared — they
 * are assigned to.
 *
 * Marks are entered as a draft and then submitted (`marksStatus`). A
 * submitted test's results reach students and parents; a submitted exam paper
 * waits for the exam to be published. Once submitted, marks are locked: the
 * School Admin reopens a paper for correction (recorded), which is the same
 * idea as unpublishing an exam.
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

/** Papers whose results students and parents may see: submitted tests and published exams. */
export const VISIBLE_PAPER: Prisma.AssessmentWhereInput = {
  OR: [{ examId: null, marksStatus: "SUBMITTED" }, { exam: { status: "PUBLISHED" } }],
};

/** Held papers whose marks are still a draft — what the office chases. */
export const PENDING_PAPER = (now: Date): Prisma.AssessmentWhereInput => ({
  date: { lte: now },
  marksStatus: "DRAFT",
  OR: [{ examId: null }, { exam: { status: "DRAFT" } }],
});

/**
 * Tests that concern one student by stream: whole-section tests, and tests
 * for their own stream. A Science test is not an Arts student's business.
 */
export async function studentStreamWhere(
  ctx: TenantContext,
  studentId: string,
  academicSessionId: string,
): Promise<Prisma.AssessmentWhereInput> {
  const enrollment = await ctx.db.studentEnrollment.findFirst({
    where: { studentId, academicSessionId, status: "ACTIVE" },
    select: { streamId: true, section: { select: { streamId: true } } },
  });
  const stream = enrollment?.streamId ?? enrollment?.section.streamId ?? null;
  return stream ? { OR: [{ streamId: null }, { streamId: stream }] } : { streamId: null };
}

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
  assertCan(ctx, "exams", "EDIT");
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
      verifiedAt: true,
      verifiedById: true,
      publishedById: true,
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
  assertCan(ctx, "exams", "EDIT");
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
  assertCan(ctx, "exams", "DELETE");
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

/**
 * Active students of a section in a session, in roll order — only one
 * stream's students when the test is for that stream.
 */
async function sectionRoster(ctx: TenantContext, sectionId: string, academicSessionId: string, streamId: string | null = null) {
  const rows = await ctx.db.studentEnrollment.findMany({
    where: {
      sectionId,
      academicSessionId,
      status: "ACTIVE",
      student: { status: "ACTIVE" },
      ...(streamId ? { OR: [{ streamId }, { streamId: null, section: { streamId } }] } : {}),
    },
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
 * grade and overall result, by the school's grading rules.
 *
 * The total is marks over the maximum of the papers the student sat or was
 * absent from: an absent paper counts as zero, an exempt paper is left out of
 * both — so one child's total can be out of less than the class's.
 */
export function tabulate(
  papers: PaperRow[],
  roster: Array<{ studentId: string; name: string; admissionNumber: string; rollNumber: string | null }>,
  results: Array<{ assessmentId: string; studentId: string; marksObtained: number | null; absent: boolean; exempt?: boolean; remarks: string | null }>,
  rules: GradingRules = DEFAULT_RULES,
) {
  const byKey = new Map(results.map((row) => [`${row.assessmentId}:${row.studentId}`, row]));

  return roster.map((student) => {
    const outcomes: PaperOutcome[] = [];
    let obtained = 0;
    let maxTotal = 0;
    const marks = papers.map((paper) => {
      const result = byKey.get(`${paper.id}:${student.studentId}`) ?? null;
      const outcome = paperOutcome(paper, result, rules.passPercent);
      outcomes.push(outcome);
      if (outcome !== "EXEMPT") maxTotal += paper.maxMarks;
      if (result?.marksObtained && !result.exempt) obtained += result.marksObtained;
      const percent = result?.marksObtained !== null && result?.marksObtained !== undefined && !result.exempt ? percentage(result.marksObtained, paper.maxMarks) : null;
      return {
        assessmentId: paper.id,
        marksObtained: result?.exempt ? null : (result?.marksObtained ?? null),
        absent: result?.absent ?? false,
        exempt: result?.exempt ?? false,
        remark: result?.remarks ?? null,
        grade: result?.absent || result?.exempt ? null : gradeFor(percent, rules.bands),
        outcome,
      };
    });
    const complete = !outcomes.includes("PENDING");
    const percent = complete && maxTotal > 0 ? percentage(obtained, maxTotal) : null;
    return {
      ...student,
      marks,
      total: obtained,
      maxTotal,
      percent,
      grade: gradeFor(percent, rules.bands),
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
  assertCan(ctx, "exams", "VIEW");
  const exam = await requireExam(ctx, examId);
  const [papers, roster] = await Promise.all([
    examPapers(ctx, exam.id),
    sectionRoster(ctx, exam.sectionId, exam.academicSessionId),
  ]);
  const [results, rules, submitted] = await Promise.all([
    ctx.db.assessmentResult.findMany({
      where: { assessmentId: { in: papers.map((paper) => paper.id) } },
      select: { assessmentId: true, studentId: true, marksObtained: true, absent: true, exempt: true, remarks: true },
    }),
    gradingRules(ctx),
    ctx.db.assessment.count({ where: { examId: exam.id, marksStatus: "SUBMITTED" } }),
  ]);
  const students = tabulate(papers, roster, results, rules);
  const enteredBy = new Map<string, number>();
  for (const row of results) {
    if (isEntered(row)) enteredBy.set(row.assessmentId, (enteredBy.get(row.assessmentId) ?? 0) + 1);
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
    rules,
    review: {
      /** Papers whose marks the teacher (or office) has submitted. */
      submittedPapers: submitted,
      verified: exam.verifiedAt !== null,
      verifiedAt: exam.verifiedAt,
      /** Verify needs every paper complete and submitted; publish needs verification. */
      canVerify: exam.status !== "PUBLISHED" && exam.verifiedAt === null && !publishBlocker(progress) && submitted === rows.length && rows.length > 0,
    },
  };
}

export async function listExams(
  ctx: TenantContext,
  filters: { academicSessionId?: string; sectionId?: string; status?: ExamStatus } = {},
) {
  assertCan(ctx, "exams", "VIEW");
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
      verifiedAt: true,
      startDate: true,
      endDate: true,
      sectionId: true,
      section: { select: { ...SECTION_LABEL_SELECT, class: { select: { name: true, level: true } } } },
      papers: {
        select: {
          id: true,
          date: true,
          marksStatus: true,
          _count: { select: { results: { where: { OR: [{ marksObtained: { not: null } }, { absent: true }, { exempt: true }] } } } },
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
        /** Every paper's marks submitted (needed before verifying). */
        allSubmitted: exam.papers.length > 0 && exam.papers.every((paper) => paper.marksStatus === "SUBMITTED"),
        /** Reviewed and verified: required before publishing. */
        verified: exam.verifiedAt !== null,
        /** DRAFT → IN_PROGRESS → MARKS_PENDING → READY_TO_PUBLISH → PUBLISHED, from the marks. */
        stage: examStage(progress),
      };
    })
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime() || a.level - b.level || a.section.localeCompare(b.section));
}

/** Why an exam cannot be verified yet, or null when it can: every paper held, complete and submitted. */
async function verifyBlocker(ctx: TenantContext, exam: { id: string; sectionId: string; academicSessionId: string }) {
  const [papers, roster] = await Promise.all([
    ctx.db.assessment.findMany({ where: { examId: exam.id }, select: { id: true, marksStatus: true, subject: { select: { name: true } } } }),
    sectionRoster(ctx, exam.sectionId, exam.academicSessionId),
  ]);
  const entered = await ctx.db.assessmentResult.count({
    where: {
      assessmentId: { in: papers.map((paper) => paper.id) },
      studentId: { in: roster.map((row) => row.studentId) },
      OR: [{ marksObtained: { not: null } }, { absent: true }, { exempt: true }],
    },
  });
  const notHeld = await ctx.db.assessment.count({ where: { examId: exam.id, date: { gt: today() } } });
  const blocker = publishBlocker({ published: false, papers: papers.length, notHeld, entered, expected: papers.length * roster.length });
  if (blocker) return blocker;
  const unsubmitted = papers.filter((paper) => paper.marksStatus !== "SUBMITTED");
  if (unsubmitted.length) {
    return {
      headline: "Marks not submitted yet.",
      detail: `${unsubmitted.map((paper) => paper.subject.name).join(", ")} still ${unsubmitted.length === 1 ? "has" : "have"} draft marks. The teacher (or the office) submits them first.`,
      action: "marks" as const,
    };
  }
  return null;
}

/**
 * Review step: a School Admin or Principal checks the submitted marks and
 * verifies the exam. Needs every paper complete and submitted. Reopening a
 * paper or withdrawing the results clears it again.
 */
export async function verifyExam(ctx: TenantContext, examId: string): Promise<void> {
  assertCan(ctx, "exams", "APPROVE");
  const exam = await requireExam(ctx, examId);
  if (exam.status === "PUBLISHED") throw new AppError("VALIDATION", "These results are already published.");
  if (exam.verifiedAt) return;
  const blocker = await verifyBlocker(ctx, exam);
  if (blocker) throw new AppError("VALIDATION", `${blocker.headline} ${blocker.detail}`);
  const { count } = await ctx.db.exam.updateMany({ where: { id: exam.id, status: "DRAFT", verifiedAt: null }, data: { verifiedAt: new Date(), verifiedById: ctx.user.id } });
  if (!count) return;
  await recordAudit({
    action: "RESULTS_VERIFIED",
    entityType: "Exam",
    entityId: exam.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Results of "${exam.name}" for ${sectionLabel(exam.section)} reviewed and verified.`,
  });
}

/**
 * Publish results. Each exam must be complete, submitted and verified first —
 * draft or unchecked marks never reach families. Refused for any one exam and
 * then for none of them: a report card with blank subjects is not a result.
 */
export async function publishExams(ctx: TenantContext, examIds: string[]): Promise<{ published: number }> {
  assertCan(ctx, "exams", "PUBLISH");
  const unique = [...new Set(examIds)];
  const exams = await ctx.db.exam.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, status: true, verifiedAt: true, sectionId: true, academicSessionId: true, section: { select: SECTION_LABEL_SELECT } },
  });
  if (exams.length !== unique.length) throw new NotFoundError("An exam was not found.");

  const incomplete: Array<{ label: string; headline: string; detail: string; action: "papers" | "marks" }> = [];
  for (const exam of exams) {
    if (exam.status === "PUBLISHED") continue;
    const blocker = await verifyBlocker(ctx, exam);
    if (blocker) incomplete.push({ label: sectionLabel(exam.section), ...blocker });
    else if (!exam.verifiedAt) incomplete.push({ label: sectionLabel(exam.section), headline: "Not verified yet.", detail: "A School Admin or Principal reviews and verifies the marks before they are published.", action: "marks" });
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
  const now = new Date();
  await ctx.db.exam.updateMany({
    where: { id: { in: toPublish.map((exam) => exam.id) }, status: "DRAFT", verifiedAt: { not: null } },
    data: { status: "PUBLISHED", publishedAt: now, publishedById: ctx.user.id },
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

/**
 * Withdraw published results — always with the reason, which is on the audit
 * log. The papers open again, and the exam must be verified again before it
 * can be republished. (For one wrong mark, `correctPublishedResult` keeps the
 * rest of the results in families' hands.)
 */
export async function unpublishExam(ctx: TenantContext, examId: string, reason: string): Promise<void> {
  assertCan(ctx, "exams", "PUBLISH");
  const why = reason.trim();
  if (why.length < 3) throw new AppError("VALIDATION", "Say why the results are being withdrawn.");
  const exam = await requireExam(ctx, examId);
  if (exam.status !== "PUBLISHED") return;
  // Withdrawn for correction: the papers open again too.
  await ctx.db.$transaction([
    ctx.db.exam.updateMany({ where: { id: exam.id }, data: { status: "DRAFT", publishedAt: null, publishedById: null, verifiedAt: null, verifiedById: null } }),
    ctx.db.assessment.updateMany({ where: { examId: exam.id }, data: { marksStatus: "DRAFT", submittedAt: null, submittedById: null } }),
  ]);
  await recordAudit({
    action: "RESULTS_UNPUBLISHED",
    entityType: "Exam",
    entityId: exam.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Results of "${exam.name}" for ${sectionLabel(exam.section)} withdrawn for correction: ${why}`,
    metadata: { reason: why },
  });
}

/**
 * Correct one mark on published results without withdrawing the exam. School
 * Admin or Principal only, always with a reason; the audit log keeps the old
 * and new value. Families see the corrected result straight away.
 */
export async function correctPublishedResult(
  ctx: TenantContext,
  input: { assessmentId: string; studentId: string; marks: number | null; status: "MARKS" | "ABSENT" | "EXEMPT"; reason: string },
): Promise<void> {
  assertCan(ctx, "exams", "APPROVE");
  const why = input.reason.trim();
  if (why.length < 3) throw new AppError("VALIDATION", "Say why the mark is being corrected.");
  const paper = await ctx.db.assessment.findFirst({
    where: { id: input.assessmentId },
    select: { id: true, name: true, maxMarks: true, sectionId: true, academicSessionId: true, streamId: true, subject: { select: { name: true } }, section: { select: SECTION_LABEL_SELECT }, exam: { select: { id: true, name: true, status: true } } },
  });
  if (!paper) throw new NotFoundError("That paper was not found.");
  if (paper.exam?.status !== "PUBLISHED") throw new AppError("VALIDATION", "These results are not published. Correct the marks on the marks sheet instead.");
  const roster = await sectionRoster(ctx, paper.sectionId, paper.academicSessionId, paper.streamId);
  if (!roster.some((row) => row.studentId === input.studentId)) throw new NotFoundError("That student is not in this class.");
  if (input.status === "MARKS") {
    if (input.marks === null || !Number.isInteger(input.marks) || input.marks < 0 || input.marks > paper.maxMarks) {
      throw new ValidationError("Please correct the highlighted fields.", { marks: [`Marks must be a whole number from 0 to ${paper.maxMarks}.`] });
    }
  }
  const previous = await ctx.db.assessmentResult.findFirst({ where: { assessmentId: paper.id, studentId: input.studentId }, select: { marksObtained: true, absent: true, exempt: true } });
  const data = { marksObtained: input.status === "MARKS" ? input.marks : null, absent: input.status === "ABSENT", exempt: input.status === "EXEMPT" };
  await ctx.db.assessmentResult.upsert({
    where: { schoolId_assessmentId_studentId: { schoolId: ctx.schoolId, assessmentId: paper.id, studentId: input.studentId } },
    create: { schoolId: ctx.schoolId, assessmentId: paper.id, studentId: input.studentId, ...data },
    update: data,
  });
  const label = (row: { marksObtained: number | null; absent: boolean; exempt: boolean } | null) => (!row ? "no entry" : row.exempt ? "Exempt" : row.absent ? "Absent" : String(row.marksObtained));
  const student = roster.find((row) => row.studentId === input.studentId)!;
  await recordAudit({
    action: "RESULT_CORRECTED",
    entityType: "Assessment",
    entityId: paper.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Published result corrected: ${student.name}, ${paper.subject.name} — ${paper.exam.name} (${sectionLabel(paper.section)}): ${label(previous)} → ${label(data)}. Reason: ${why}`,
    metadata: { studentId: input.studentId, examId: paper.exam.id, from: previous, to: data, reason: why },
  });
}

// -----------------------------------------------------------------------------
// Papers and marks (School Admin and the subject's teacher)
// -----------------------------------------------------------------------------

/**
 * A paper this user may enter marks for, or a refusal. The admin may reach
 * any of their school's papers. A teacher reaches an exam paper of a subject
 * they teach that section this session, and a test only if they set it and
 * still teach that subject (and stream) there — never another teacher's test.
 */
async function requirePaper(ctx: TenantContext, assessmentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "PRINCIPAL", "TEACHER");
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
      streamId: true,
      description: true,
      marksStatus: true,
      submittedAt: true,
      subject: { select: { name: true } },
      section: { select: SECTION_LABEL_SELECT },
      stream: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      exam: { select: { id: true, name: true, status: true } },
    },
  });
  if (!paper) throw new NotFoundError("That paper was not found.");

  if (ctx.user.role === "TEACHER") {
    const me = await requireTeacherSelf(ctx);
    if (!paper.exam && paper.teacherId !== me.id) {
      throw new ForbiddenError("This test belongs to another teacher. Only the teacher who set it, or the school office, can change its marks.");
    }
    // An exam paper for one stream: only a teacher of that stream (or of the
    // whole section) may mark it — not a teacher of the same subject in another stream.
    if (paper.exam && paper.streamId) await requireStreamTeaching(ctx, { sectionId: paper.sectionId, subjectId: paper.subjectId, streamId: paper.streamId, academicSessionId: paper.academicSessionId });
    else if (paper.exam) await requireSubjectAssignment(ctx, paper.sectionId, paper.subjectId, paper.academicSessionId);
    else await requireTeachingAssignment(ctx, paper.sectionId, paper.subjectId, paper.streamId, paper.academicSessionId);
  }
  return paper;
}

export async function getMarksSheet(ctx: TenantContext, assessmentId: string) {
  const paper = await requirePaper(ctx, assessmentId);
  const [roster, results] = await Promise.all([
    sectionRoster(ctx, paper.sectionId, paper.academicSessionId, paper.streamId),
    ctx.db.assessmentResult.findMany({
      where: { assessmentId: paper.id },
      select: { studentId: true, marksObtained: true, absent: true, exempt: true, remarks: true },
    }),
  ]);
  const rules = await gradingRules(ctx);
  const byStudent = new Map(results.map((row) => [row.studentId, row]));
  const passMark = passMarkFor(paper.maxMarks, paper.passMarks, rules.passPercent);
  const held = paper.date <= today();
  const published = paper.exam?.status === "PUBLISHED";
  const submitted = paper.marksStatus === "SUBMITTED";
  const rows = roster.map((student) => {
    const result = byStudent.get(student.studentId) ?? null;
    const marks = result?.exempt ? null : (result?.marksObtained ?? null);
    return {
      ...student,
      marksObtained: marks,
      absent: result?.absent ?? false,
      exempt: result?.exempt ?? false,
      remark: result?.remarks ?? null,
      percent: marks === null ? null : percentage(marks, paper.maxMarks),
      /** Entered, absent, exempt, or still missing — what the teacher must finish. */
      entry: result?.exempt ? ("EXEMPT" as const) : result?.absent ? ("ABSENT" as const) : marks !== null ? ("ENTERED" as const) : ("MISSING" as const),
      outcome: paperOutcome(paper, result, rules.passPercent),
    };
  });

  return {
    paper: {
      id: paper.id,
      name: paper.name,
      subject: paper.subject.name,
      section: sectionLabel(paper.section),
      stream: paper.stream?.name ?? null,
      description: paper.description,
      teacher: paper.teacher ? fullName(paper.teacher) : null,
      date: paper.date,
      maxMarks: paper.maxMarks,
      passMarks: passMark,
      exam: paper.exam,
      marksStatus: paper.marksStatus,
      submittedAt: paper.submittedAt,
    },
    stage: testStage({ held, kind: paper.exam ? "EXAM" : "TEST", marksStatus: paper.marksStatus, published, entered: rows.filter((row) => row.entry !== "MISSING").length }),
    /** Marks open on the paper's date, as a draft, until they are submitted. */
    editable: !published && !submitted && held,
    held,
    /** Every student has a mark or is marked absent. */
    complete: rows.every((row) => row.entry !== "MISSING"),
    canSubmit: !published && !submitted && held,
    /** The office reopens a submitted paper for correction (an exam: by unpublishing). */
    canReopen: isSchoolLeader(ctx.user.role) && submitted && !published,
    rows,
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
  if (paper.marksStatus === "SUBMITTED") {
    throw new AppError("VALIDATION", "These marks were submitted, so they are locked. The school office can reopen them for a correction.");
  }
  if (paper.date > today()) {
    throw new AppError("VALIDATION", `This paper is on ${formatDate(paper.date)}. Marks can be entered from that day.`);
  }
  if (!entries.length) throw new ValidationError("Enter at least one mark.");

  const roster = new Set((await sectionRoster(ctx, paper.sectionId, paper.academicSessionId, paper.streamId)).map((row) => row.studentId));
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
    if (entry.exempt && (entry.marks !== null || entry.absent)) (errors[key] ??= []).push("An exempt student has no marks and is not absent.");
    if (entry.marks !== null && (!Number.isInteger(entry.marks) || entry.marks < 0 || entry.marks > paper.maxMarks)) {
      (errors[key] ??= []).push(`Marks must be a whole number from 0 to ${paper.maxMarks}.`);
    }
    if (entry.remark && entry.remark.length > 300) (errors[key] ??= []).push("Keep the remark under 300 characters.");
  }
  if (Object.keys(errors).length) throw new ValidationError("Some marks need correcting.", errors);

  const toClear = entries.filter((entry) => entry.marks === null && !entry.absent && !entry.exempt && !entry.remark);
  const toSave = entries.filter((entry) => !toClear.includes(entry));
  // What each mark was before, so the audit log can say exactly what changed.
  const before = new Map(
    (await ctx.db.assessmentResult.findMany({ where: { assessmentId: paper.id, studentId: { in: entries.map((e) => e.studentId) } }, select: { studentId: true, marksObtained: true, absent: true, exempt: true } })).map((row) => [row.studentId, row]),
  );
  const shown = (row: { marksObtained: number | null; absent: boolean; exempt?: boolean } | undefined) => (!row ? null : row.exempt ? "EXEMPT" : row.absent ? "ABSENT" : row.marksObtained);
  const changes = entries
    .map((entry) => ({ studentId: entry.studentId, from: shown(before.get(entry.studentId)), to: toClear.includes(entry) ? null : shown({ marksObtained: entry.marks, absent: entry.absent, exempt: entry.exempt }) }))
    .filter((change) => change.from !== change.to);

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
          marksObtained: entry.absent || entry.exempt ? null : entry.marks,
          absent: entry.exempt ? false : entry.absent,
          exempt: entry.exempt ?? false,
          remarks: entry.remark,
        },
        update: { marksObtained: entry.absent || entry.exempt ? null : entry.marks, absent: entry.exempt ? false : entry.absent, exempt: entry.exempt ?? false, remarks: entry.remark },
      }),
    ),
  ]);

  await recordAudit({
    action: "MARKS_UPDATED",
    entityType: "Assessment",
    entityId: paper.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Marks for ${paper.subject.name} — ${paper.name} (${sectionLabel(paper.section)}): ${toSave.length} saved${toClear.length ? `, ${toClear.length} cleared` : ""}${changes.length ? `, ${changes.length} changed` : ""}.`,
    // Who changed which mark, from what to what — for the school's own audit.
    metadata: changes.length ? { assessmentId: paper.id, changes: changes.slice(0, 500) } : undefined,
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
        ? "These marks are submitted or published, so they are locked. The school office can reopen them for a correction."
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

/**
 * May this teacher set a test for this subject, section and stream? Their
 * assignment must match exactly: a teacher of Science-stream Physics may set a
 * Science test, not a whole-section one, and nobody may pick a subject, class
 * or stream they are not assigned.
 */
export async function requireTeachingAssignment(
  ctx: TenantContext,
  sectionId: string,
  subjectId: string,
  streamId: string | null,
  academicSessionId: string,
): Promise<{ teacherId: string }> {
  const teacher = await requireTeacherSelf(ctx);
  const assignment = await ctx.db.teacherSubjectAssignment.findFirst({
    where: { teacherId: teacher.id, sectionId, subjectId, academicSessionId, streamId },
    select: { id: true },
  });
  if (!assignment) throw new ForbiddenError("You can only set tests for the subjects, classes and streams you are assigned to teach.");
  return { teacherId: teacher.id };
}

/** What a teacher may set a test for: their own assignments, each with the class size it reaches. */
export async function myTestOptions(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);
  const rows = await ctx.db.teacherSubjectAssignment.findMany({
    where: { teacherId: teacher.id, academicSessionId: session.id, subject: { isActive: true } },
    select: {
      sectionId: true,
      subjectId: true,
      streamId: true,
      subject: { select: { name: true } },
      stream: { select: { name: true } },
      section: { select: { name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } },
    },
  });
  const options = await Promise.all(
    rows.map(async (row) => ({
      value: `${row.sectionId}|${row.subjectId}|${row.streamId ?? ""}`,
      sectionId: row.sectionId,
      subjectId: row.subjectId,
      streamId: row.streamId,
      subject: row.subject.name,
      className: row.section.class.name,
      section: row.section.name,
      stream: row.stream?.name ?? row.section.stream?.name ?? null,
      level: row.section.class.level,
      students: (await sectionRoster(ctx, row.sectionId, session.id, row.streamId)).length,
      label: `${row.subject.name} — ${row.section.class.name} ${row.section.name}${row.stream ? ` (${row.stream.name})` : ""}`,
    })),
  );
  return options.sort((a, b) => a.level - b.level || a.section.localeCompare(b.section) || a.subject.localeCompare(b.subject));
}

/** A test the teacher sets for a subject they teach. Families see it once marks are submitted. */
export async function createClassTest(
  ctx: TenantContext,
  input: Omit<ClassTestInput, "streamId" | "description"> & { streamId?: string | null; description?: string | null },
): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);
  const streamId = input.streamId ?? null;
  const { teacherId } = await requireTeachingAssignment(ctx, input.sectionId, input.subjectId, streamId, session.id);

  const created = await ctx.db.assessment.create({
    data: {
      schoolId: ctx.schoolId,
      academicSessionId: session.id,
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      streamId,
      teacherId,
      name: input.name,
      description: input.description ?? null,
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

/** A test (not an exam paper) that this user may change: its own teacher, or the School Admin. */
async function requireOwnTest(ctx: TenantContext, assessmentId: string) {
  const paper = await requirePaper(ctx, assessmentId);
  if (paper.exam) throw new AppError("VALIDATION", "Exam papers are changed from the exam itself.");
  return paper;
}

/** Change a test's details while its marks are still a draft. */
export async function updateClassTest(ctx: TenantContext, input: UpdateClassTestInput): Promise<void> {
  const paper = await requireOwnTest(ctx, input.assessmentId);
  if (paper.marksStatus === "SUBMITTED") {
    throw new AppError("VALIDATION", "This test's marks are submitted, so it is locked. The school office can reopen it for a correction.");
  }
  const highest = await ctx.db.assessmentResult.aggregate({ where: { assessmentId: paper.id }, _max: { marksObtained: true } });
  if ((highest._max.marksObtained ?? 0) > input.maxMarks) {
    throw new ValidationError("Please correct the highlighted fields.", {
      maxMarks: [`A student already has ${highest._max.marksObtained} marks. The maximum cannot be lower than that.`],
    });
  }
  await ctx.db.assessment.updateMany({
    where: { id: paper.id },
    data: { name: input.name, date: input.date, maxMarks: input.maxMarks, description: input.description ?? null },
  });
  await recordAudit({
    action: "CLASS_TEST_UPDATED",
    entityType: "Assessment",
    entityId: paper.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${paper.subject.name} test "${input.name}" for ${sectionLabel(paper.section)} updated.`,
  });
}

/** Delete a test only while no marks have been entered — anything else is a record. */
export async function deleteClassTest(ctx: TenantContext, assessmentId: string): Promise<void> {
  const paper = await requireOwnTest(ctx, assessmentId);
  const marked = await ctx.db.assessmentResult.count({ where: { assessmentId: paper.id } });
  if (marked || paper.marksStatus === "SUBMITTED") {
    throw new ConflictError("Marks have been entered for this test, so it is kept as a record. Clear the marks first if it was set by mistake.");
  }
  await ctx.db.assessment.deleteMany({ where: { id: paper.id } });
  await recordAudit({
    action: "CLASS_TEST_DELETED",
    entityType: "Assessment",
    entityId: paper.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${paper.subject.name} test "${paper.name}" for ${sectionLabel(paper.section)} deleted (no marks).`,
  });
}

/**
 * Hand in a paper's marks. Every student needs a mark or "absent" first. A
 * test's results then reach students and parents; an exam paper's wait for
 * the exam to be published. Either way the marks lock.
 */
export async function submitMarks(ctx: TenantContext, assessmentId: string): Promise<{ visibleNow: boolean }> {
  const sheet = await getMarksSheet(ctx, assessmentId);
  if (sheet.paper.marksStatus === "SUBMITTED") throw new AppError("VALIDATION", "These marks are already submitted.");
  if (sheet.paper.exam?.status === "PUBLISHED") throw new AppError("VALIDATION", "These results are already published.");
  if (!sheet.held) throw new AppError("VALIDATION", `This test is on ${formatDate(sheet.paper.date)}. Marks can be submitted after it is held.`);
  if (!sheet.rows.length) throw new AppError("VALIDATION", "There are no students to submit marks for.");
  const missing = sheet.rows.filter((row) => row.entry === "MISSING");
  if (missing.length) {
    throw new AppError(
      "VALIDATION",
      `${missing.length} student${missing.length === 1 ? " has" : "s have"} no marks yet (${missing.slice(0, 3).map((row) => row.name).join(", ")}${missing.length > 3 ? "…" : ""}). Enter marks or tick Absent or Exempt, save, then submit.`,
    );
  }
  const { count } = await ctx.db.assessment.updateMany({
    where: { id: assessmentId, marksStatus: "DRAFT" },
    data: { marksStatus: "SUBMITTED", submittedAt: new Date(), submittedById: ctx.user.id },
  });
  if (!count) throw new AppError("VALIDATION", "These marks are already submitted.");
  await recordAudit({
    action: "MARKS_SUBMITTED",
    entityType: "Assessment",
    entityId: assessmentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Marks submitted for ${sheet.paper.subject} — ${sheet.paper.name} (${sheet.paper.section}).`,
  });
  return { visibleNow: !sheet.paper.exam };
}

/** School Admin: reopen submitted marks for a correction. The reason is recorded. */
export async function reopenMarks(ctx: TenantContext, assessmentId: string, reason: string): Promise<void> {
  assertCan(ctx, "exams", "EDIT");
  const paper = await requirePaper(ctx, assessmentId);
  if (paper.exam?.status === "PUBLISHED") {
    throw new AppError("VALIDATION", "This exam's results are published. Unpublish the exam to correct its marks.");
  }
  if (paper.marksStatus !== "SUBMITTED") return;
  await ctx.db.$transaction([
    ctx.db.assessment.updateMany({ where: { id: paper.id }, data: { marksStatus: "DRAFT", submittedAt: null, submittedById: null } }),
    // Changed marks must be checked again before the exam is published.
    ...(paper.exam ? [ctx.db.exam.updateMany({ where: { id: paper.exam.id }, data: { verifiedAt: null, verifiedById: null } })] : []),
  ]);
  await recordAudit({
    action: "MARKS_REOPENED",
    entityType: "Assessment",
    entityId: paper.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Marks for ${paper.subject.name} — ${paper.name} (${sectionLabel(paper.section)}) reopened for correction: ${reason}`,
  });
}

// -----------------------------------------------------------------------------
// Where a test stands — one vocabulary for every screen
// -----------------------------------------------------------------------------

export type TestStage = "UPCOMING" | "ENTER_MARKS" | "DRAFT" | "SUBMITTED" | "PUBLISHED";

export const TEST_STAGE_LABEL: Record<TestStage, string> = {
  UPCOMING: "Upcoming",
  ENTER_MARKS: "Enter marks",
  DRAFT: "Draft saved",
  SUBMITTED: "Submitted — awaiting publication",
  PUBLISHED: "Published",
};

/**
 * Upcoming (not held yet) → Enter marks (held, none entered) → Draft saved →
 * Submitted (an exam paper waiting for the exam to be published) → Published
 * (a submitted test, or a published exam's paper).
 */
export function testStage(input: { held: boolean; kind: "EXAM" | "TEST"; marksStatus: "DRAFT" | "SUBMITTED"; published: boolean; entered: number }): TestStage {
  if (input.published) return "PUBLISHED";
  if (input.marksStatus === "SUBMITTED") return input.kind === "TEST" ? "PUBLISHED" : "SUBMITTED";
  if (!input.held) return "UPCOMING";
  return input.entered ? "DRAFT" : "ENTER_MARKS";
}

const TEST_ROW_SELECT = {
  id: true,
  name: true,
  date: true,
  maxMarks: true,
  sectionId: true,
  streamId: true,
  academicSessionId: true,
  marksStatus: true,
  submittedAt: true,
  teacherId: true,
  subject: { select: { id: true, name: true } },
  section: { select: { ...SECTION_LABEL_SELECT, classId: true, class: { select: { name: true, level: true } } } },
  stream: { select: { name: true } },
  teacher: { select: { firstName: true, lastName: true } },
  exam: { select: { id: true, name: true, status: true } },
  _count: { select: { results: { where: { OR: [{ marksObtained: { not: null } }, { absent: true }, { exempt: true }] } } } },
} satisfies Prisma.AssessmentSelect;

/** Class sizes for a set of tests, counting only the stream a stream test is for. */
async function expectedCounts(ctx: TenantContext, rows: Array<{ id: string; sectionId: string; streamId: string | null; academicSessionId: string }>) {
  const keys = [...new Set(rows.map((row) => `${row.academicSessionId}|${row.sectionId}|${row.streamId ?? ""}`))];
  const sizes = new Map<string, number>();
  await Promise.all(
    keys.map(async (key) => {
      const [sessionId, sectionId, streamId] = key.split("|");
      sizes.set(key, (await sectionRoster(ctx, sectionId!, sessionId!, streamId || null)).length);
    }),
  );
  return (row: { sectionId: string; streamId: string | null; academicSessionId: string }) => sizes.get(`${row.academicSessionId}|${row.sectionId}|${row.streamId ?? ""}`) ?? 0;
}

function shapeTest(row: Prisma.AssessmentGetPayload<{ select: typeof TEST_ROW_SELECT }>, expected: number) {
  const held = row.date <= today();
  const kind = row.exam ? ("EXAM" as const) : ("TEST" as const);
  const published = row.exam?.status === "PUBLISHED";
  const stage = testStage({ held, kind, marksStatus: row.marksStatus, published, entered: row._count.results });
  return {
    id: row.id,
    name: row.exam ? row.exam.name : row.name,
    kind,
    examId: row.exam?.id ?? null,
    date: row.date,
    maxMarks: row.maxMarks,
    subject: row.subject.name,
    subjectId: row.subject.id,
    className: row.section.class.name,
    classId: row.section.classId,
    level: row.section.class.level,
    section: sectionLabel(row.section),
    sectionId: row.sectionId,
    stream: row.stream?.name ?? row.section.stream?.name ?? null,
    streamId: row.streamId,
    teacher: row.teacher ? fullName(row.teacher) : null,
    teacherId: row.teacherId,
    entered: row._count.results,
    expected,
    held,
    stage,
    stageLabel: TEST_STAGE_LABEL[stage],
  };
}

export type TestRow = ReturnType<typeof shapeTest>;

/**
 * A teacher's tests this session: tests they set, and exam papers for the
 * subjects they are assigned. Another teacher's tests never appear.
 */
export async function listMyTests(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);
  const assignments = await ctx.db.teacherSubjectAssignment.findMany({
    where: { teacherId: teacher.id, academicSessionId: session.id },
    select: { sectionId: true, subjectId: true },
  });
  const rows = await ctx.db.assessment.findMany({
    where: {
      academicSessionId: session.id,
      OR: [
        { examId: null, teacherId: teacher.id },
        ...(assignments.length ? [{ examId: { not: null }, OR: assignments.map((row) => ({ sectionId: row.sectionId, subjectId: row.subjectId })) }] : []),
      ],
    },
    orderBy: [{ date: "desc" }],
    select: TEST_ROW_SELECT,
  });
  const expected = await expectedCounts(ctx, rows);
  return rows.map((row) => shapeTest(row, expected(row)));
}

export type TestFilters = {
  view?: "all" | "pending" | "published";
  classId?: string;
  sectionId?: string;
  streamId?: string;
  subjectId?: string;
  teacherId?: string;
  q?: string;
};

/**
 * School Admin: every test and exam paper this session, filtered.
 *   * pending — held, marks still a draft (or not started);
 *   * published — results families can see (submitted tests, published exams).
 */
export async function listTests(ctx: TenantContext, filters: TestFilters = {}) {
  assertCan(ctx, "exams", "VIEW");
  const session = await requireCurrentSession(ctx);
  const now = today();
  // Each filter is its own AND clause, so their ORs never overwrite each other.
  const and: Prisma.AssessmentWhereInput[] = [{ academicSessionId: session.id }];
  if (filters.sectionId) and.push({ sectionId: filters.sectionId });
  if (filters.classId) and.push({ section: { classId: filters.classId } });
  if (filters.streamId) and.push({ OR: [{ streamId: filters.streamId }, { section: { streamId: filters.streamId } }] });
  if (filters.subjectId) and.push({ subjectId: filters.subjectId });
  if (filters.teacherId) and.push({ teacherId: filters.teacherId });
  if (filters.q) and.push({ name: { contains: filters.q, mode: "insensitive" } });
  if (filters.view === "pending") and.push(PENDING_PAPER(now));
  if (filters.view === "published") and.push(VISIBLE_PAPER);
  const rows = await ctx.db.assessment.findMany({
    where: { AND: and },
    orderBy: [{ date: "desc" }],
    take: 300,
    select: TEST_ROW_SELECT,
  });
  const expected = await expectedCounts(ctx, rows);
  return rows.map((row) => shapeTest(row, expected(row)));
}

/** Counts for the admin's tabs. */
export async function testCounts(ctx: TenantContext) {
  assertCan(ctx, "exams", "VIEW");
  const session = await requireCurrentSession(ctx);
  const now = today();
  const [all, pending, published] = await Promise.all([
    ctx.db.assessment.count({ where: { academicSessionId: session.id } }),
    ctx.db.assessment.count({ where: { AND: [{ academicSessionId: session.id }, PENDING_PAPER(now)] } }),
    ctx.db.assessment.count({ where: { academicSessionId: session.id, ...VISIBLE_PAPER } }),
  ]);
  return { all, pending, published };
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
      // Exam papers for their subjects; tests only their own — never another teacher's.
      OR: [
        { examId: null, teacherId: teacher.id },
        { examId: { not: null }, OR: assignments.map((row) => ({ sectionId: row.sectionId, subjectId: row.subjectId })) },
      ],
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
      _count: { select: { results: { where: { OR: [{ marksObtained: { not: null } }, { absent: true }, { exempt: true }] } } } },
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
