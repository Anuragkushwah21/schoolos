import "server-only";

import { attendedShare, emptyCounts } from "@/server/attendance/service";
import { NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { tabulate } from "@/server/exams/service";
import { findChild } from "@/server/parent/access";
import { findStudentSelf } from "@/server/student/access";

/**
 * Published exam results and report cards.
 *
 * The School Admin may open any report card of their school, draft or
 * published. A parent may open a linked child's, and a student their own —
 * both only once the exam is PUBLISHED. Anyone else, and any exam or student
 * outside those, gets the same not-found.
 */

const NOT_FOUND = "That report card was not found.";

async function assertCanSee(ctx: TenantContext, studentId: string, published: boolean): Promise<void> {
  switch (ctx.user.role) {
    case "SCHOOL_ADMIN":
      return;
    case "PARENT":
      if (published && (await findChild(ctx, studentId).catch(() => null))) return;
      break;
    case "STUDENT":
      if (published && (await findStudentSelf(ctx).catch(() => null))?.student.id === studentId) return;
      break;
  }
  throw new NotFoundError(NOT_FOUND);
}

export async function getReportCard(ctx: TenantContext, examId: string, studentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "PARENT", "STUDENT");

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
      academicSession: { select: { name: true, startDate: true } },
      section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
    },
  });
  if (!exam) throw new NotFoundError(NOT_FOUND);
  await assertCanSee(ctx, studentId, exam.status === "PUBLISHED");

  const enrollment = await ctx.db.studentEnrollment.findFirst({
    where: { studentId, academicSessionId: exam.academicSessionId, sectionId: exam.sectionId },
    select: {
      rollNumber: true,
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          dateOfBirth: true,
          parents: {
            orderBy: { isPrimary: "desc" },
            take: 1,
            select: { relationship: true, parent: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  });
  if (!enrollment) throw new NotFoundError(NOT_FOUND);

  const [papers, school, attendance, classTeacher] = await Promise.all([
    ctx.db.assessment.findMany({
      where: { examId: exam.id },
      orderBy: [{ subject: { name: "asc" } }],
      select: {
        id: true,
        maxMarks: true,
        passMarks: true,
        date: true,
        subject: { select: { id: true, name: true } },
        results: {
          where: { studentId },
          select: { assessmentId: true, studentId: true, marksObtained: true, absent: true, remarks: true },
        },
      },
    }),
    ctx.db.school.findFirst({
      select: {
        name: true,
        logoUrl: true,
        addressLine: true,
        city: true,
        state: true,
        postalCode: true,
        phone: true,
        email: true,
        affiliationBoard: true,
        udiseCode: true,
        primaryColor: true,
        receiptHeaderNote: true,
      },
    }),
    // Attendance for the session up to the end of the exam: the figure a
    // report card traditionally prints beside the marks.
    ctx.db.studentAttendance.groupBy({
      by: ["status"],
      where: { studentId, academicSessionId: exam.academicSessionId, date: { lte: exam.endDate } },
      _count: { _all: true },
    }),
    ctx.db.classTeacherAssignment.findFirst({
      where: { sectionId: exam.sectionId, toDate: null },
      select: { teacher: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  if (!school) throw new NotFoundError(NOT_FOUND);

  const [row] = tabulate(
    papers.map((paper) => ({
      id: paper.id,
      subjectId: paper.subject.id,
      subject: paper.subject.name,
      maxMarks: paper.maxMarks,
      passMarks: paper.passMarks,
      date: paper.date,
      teacher: null,
    })),
    [
      {
        studentId,
        name: fullName(enrollment.student),
        admissionNumber: enrollment.student.admissionNumber,
        rollNumber: enrollment.rollNumber,
      },
    ],
    papers.flatMap((paper) => paper.results),
  );

  const counts = emptyCounts();
  for (const group of attendance) {
    counts[group.status] += group._count._all;
    counts.total += group._count._all;
  }
  const guardian = enrollment.student.parents[0] ?? null;

  return {
    school: {
      name: school.name,
      logoUrl: school.logoUrl,
      address: [school.addressLine, school.city, school.state, school.postalCode].filter(Boolean).join(", ") || null,
      phone: school.phone,
      email: school.email,
      affiliation: school.affiliationBoard,
      udiseCode: school.udiseCode,
      headerNote: school.receiptHeaderNote,
      primaryColor: school.primaryColor,
    },
    exam: {
      id: exam.id,
      name: exam.name,
      status: exam.status,
      startDate: exam.startDate,
      endDate: exam.endDate,
      session: exam.academicSession.name,
    },
    student: {
      id: studentId,
      name: fullName(enrollment.student),
      admissionNumber: enrollment.student.admissionNumber,
      dateOfBirth: enrollment.student.dateOfBirth,
      className: exam.section.class.name,
      sectionName: exam.section.name,
      sectionLabel: sectionLabel(exam.section),
      rollNumber: enrollment.rollNumber,
      guardian: guardian ? { name: fullName(guardian.parent), relationship: guardian.relationship } : null,
    },
    classTeacher: classTeacher ? fullName(classTeacher.teacher) : null,
    subjects: papers.map((paper, index) => ({
      subject: paper.subject.name,
      maxMarks: paper.maxMarks,
      passMarks: paper.passMarks,
      ...row!.marks[index]!,
    })),
    total: row!.total,
    maxTotal: row!.maxTotal,
    percent: row!.percent,
    grade: row!.grade,
    outcome: row!.outcome,
    attendance: { counts, share: attendedShare(counts) },
  };
}

export type ReportCard = Awaited<ReturnType<typeof getReportCard>>;

/**
 * A student's published exams this session, with the headline figures. Called
 * for the student themselves or, for a parent, after the guardian link check.
 */
export async function publishedExamsFor(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "PARENT", "STUDENT");
  await assertCanSee(ctx, studentId, true);

  const enrollments = await ctx.db.studentEnrollment.findMany({
    where: { studentId, academicSession: { isCurrent: true } },
    select: { sectionId: true, academicSessionId: true },
  });
  if (!enrollments.length) return [];

  const exams = await ctx.db.exam.findMany({
    where: {
      status: "PUBLISHED",
      OR: enrollments.map((row) => ({ sectionId: row.sectionId, academicSessionId: row.academicSessionId })),
    },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      papers: {
        select: {
          id: true,
          maxMarks: true,
          passMarks: true,
          date: true,
          subject: { select: { id: true, name: true } },
          results: {
            where: { studentId },
            select: { assessmentId: true, studentId: true, marksObtained: true, absent: true, remarks: true },
          },
        },
      },
    },
  });

  return exams.map((exam) => {
    const [row] = tabulate(
      exam.papers.map((paper) => ({
        id: paper.id,
        subjectId: paper.subject.id,
        subject: paper.subject.name,
        maxMarks: paper.maxMarks,
        passMarks: paper.passMarks,
        date: paper.date,
        teacher: null,
      })),
      [{ studentId, name: "", admissionNumber: "", rollNumber: null }],
      exam.papers.flatMap((paper) => paper.results),
    );
    return {
      id: exam.id,
      name: exam.name,
      startDate: exam.startDate,
      endDate: exam.endDate,
      percent: row!.percent,
      grade: row!.grade,
      outcome: row!.outcome,
      total: row!.total,
      maxTotal: row!.maxTotal,
    };
  });
}
