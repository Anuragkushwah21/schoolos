import "server-only";

import type { Gender } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { tabulate } from "@/server/exams/service";
import { listFeePositions } from "@/server/finance/fees";

/**
 * School Admin reports that are tables rather than charts: the lists an office
 * prints or hands to a spreadsheet. Everything reads through `ctx.db`, so a
 * report can only ever describe the caller's own school, and every function
 * re-asserts SCHOOL_ADMIN because each is also reachable from a CSV download.
 */

export type ReportTable = { head: string[]; rows: Array<Array<string | number>> };

async function currentSessionId(ctx: TenantContext): Promise<string | null> {
  return (await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id ?? null;
}

const GENDER_LABEL: Record<Gender, string> = { MALE: "Boy", FEMALE: "Girl", OTHER: "Other" };

/** Every student placed this session, with class, section and primary guardian. */
export async function studentListReport(ctx: TenantContext): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const sessionId = await currentSessionId(ctx);
  const enrollments = sessionId
    ? await ctx.db.studentEnrollment.findMany({
        where: { academicSessionId: sessionId },
        orderBy: [{ class: { level: "asc" } }, { section: { name: "asc" } }, { rollNumber: "asc" }],
        select: {
          rollNumber: true,
          status: true,
          class: { select: { name: true } },
          section: { select: { name: true } },
          stream: { select: { name: true } },
          student: {
            select: {
              admissionNumber: true,
              firstName: true,
              lastName: true,
              gender: true,
              dateOfBirth: true,
              status: true,
              parents: {
                orderBy: { isPrimary: "desc" },
                take: 1,
                select: { parent: { select: { firstName: true, lastName: true, phone: true } } },
              },
            },
          },
        },
      })
    : [];

  return {
    head: ["Admission no.", "Student", "Gender", "Date of birth", "Class", "Section", "Stream", "Roll no.", "Student status", "Guardian", "Guardian phone"],
    rows: enrollments.map((row) => {
      const guardian = row.student.parents[0]?.parent;
      return [
        row.student.admissionNumber,
        fullName(row.student),
        row.student.gender ? GENDER_LABEL[row.student.gender] : "",
        row.student.dateOfBirth ? formatDate(row.student.dateOfBirth) : "",
        row.class.name,
        row.section.name,
        row.stream?.name ?? "",
        row.rollNumber ?? "",
        row.student.status,
        guardian ? fullName(guardian) : "",
        guardian?.phone ?? "",
      ];
    }),
  };
}

/** Teachers with their contact details, status and what they are assigned. */
export async function teacherListReport(ctx: TenantContext): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const sessionId = await currentSessionId(ctx);
  const teachers = await ctx.db.teacher.findMany({
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: {
      employeeId: true,
      firstName: true,
      lastName: true,
      gender: true,
      phone: true,
      email: true,
      designation: true,
      status: true,
      joiningDate: true,
      _count: { select: { assignments: sessionId ? { where: { academicSessionId: sessionId } } : true } },
    },
  });

  return {
    head: ["Employee ID", "Teacher", "Gender", "Phone", "Email", "Designation", "Status", "Joining date", "Subject assignments"],
    rows: teachers.map((teacher) => [
      teacher.employeeId,
      fullName(teacher),
      teacher.gender ? humanGender(teacher.gender) : "",
      teacher.phone ?? "",
      teacher.email ?? "",
      teacher.designation ?? "",
      teacher.status,
      teacher.joiningDate ? formatDate(teacher.joiningDate) : "",
      teacher._count.assignments,
    ]),
  };
}

function humanGender(gender: Gender): string {
  return gender === "MALE" ? "Male" : gender === "FEMALE" ? "Female" : "Other";
}

/** Students per class this session, split into boys and girls. */
export async function classStrengthReport(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const sessionId = await currentSessionId(ctx);
  if (!sessionId) return { rows: [], totals: { boys: 0, girls: 0, other: 0, total: 0 } };

  const enrollments = await ctx.db.studentEnrollment.findMany({
    where: { academicSessionId: sessionId, status: "ACTIVE", student: { status: "ACTIVE" } },
    select: { class: { select: { id: true, name: true, level: true } }, student: { select: { gender: true } } },
  });

  const byClass = new Map<string, { name: string; level: number; boys: number; girls: number; other: number; total: number }>();
  for (const row of enrollments) {
    const entry = byClass.get(row.class.id) ?? { name: row.class.name, level: row.class.level, boys: 0, girls: 0, other: 0, total: 0 };
    if (row.student.gender === "MALE") entry.boys += 1;
    else if (row.student.gender === "FEMALE") entry.girls += 1;
    else entry.other += 1;
    entry.total += 1;
    byClass.set(row.class.id, entry);
  }

  const rows = [...byClass.values()].sort((a, b) => a.level - b.level);
  const totals = rows.reduce(
    (acc, row) => ({
      boys: acc.boys + row.boys,
      girls: acc.girls + row.girls,
      other: acc.other + row.other,
      total: acc.total + row.total,
    }),
    { boys: 0, girls: 0, other: 0, total: 0 },
  );
  return { rows, totals };
}

export async function classStrengthTable(ctx: TenantContext): Promise<ReportTable> {
  const { rows, totals } = await classStrengthReport(ctx);
  return {
    head: ["Class", "Boys", "Girls", "Other / not recorded", "Total"],
    rows: [
      ...rows.map((row) => [row.name, row.boys, row.girls, row.other, row.total]),
      ["Total", totals.boys, totals.girls, totals.other, totals.total],
    ],
  };
}

/** Each teacher's attendance between two dates, by status. */
/** Teachers and non-teaching staff, with their register totals for the range. */
export async function staffAttendanceReport(ctx: TenantContext, from: Date, to: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [teachers, grouped, staff, staffGrouped] = await Promise.all([
    ctx.db.teacher.findMany({
      where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, employeeId: true, firstName: true, lastName: true },
    }),
    ctx.db.teacherAttendance.groupBy({
      by: ["teacherId", "status"],
      where: { date: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    ctx.db.staffMember.findMany({
      where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, employeeId: true, firstName: true, lastName: true, role: true, designation: true },
    }),
    ctx.db.staffAttendance.groupBy({
      by: ["staffMemberId", "status"],
      where: { date: { gte: from, lte: to } },
      _count: { _all: true },
    }),
  ]);

  type Counts = { PRESENT: number; LATE: number; ABSENT: number; ON_LEAVE: number; total: number };
  const empty = (): Counts => ({ PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, total: 0 });
  const tally = (rows: Array<{ id: string; status: keyof Omit<Counts, "total">; n: number }>) => {
    const counts = new Map<string, Counts>();
    for (const row of rows) {
      const entry = counts.get(row.id) ?? empty();
      entry[row.status] += row.n;
      entry.total += row.n;
      counts.set(row.id, entry);
    }
    return counts;
  };
  const teacherCounts = tally(grouped.map((row) => ({ id: row.teacherId, status: row.status, n: row._count._all })));
  const staffCounts = tally(staffGrouped.map((row) => ({ id: row.staffMemberId, status: row.status, n: row._count._all })));
  const row = (id: string, person: { employeeId: string; firstName: string; lastName: string }, job: string, c: Counts) => ({
    id,
    employeeId: person.employeeId,
    name: fullName(person),
    job,
    counts: c,
    share: c.total ? (c.PRESENT + c.LATE) / c.total : null,
  });

  return [
    ...teachers.map((teacher) => row(`t:${teacher.id}`, teacher, "Teacher", teacherCounts.get(teacher.id) ?? empty())),
    ...staff.map((member) =>
      row(`s:${member.id}`, member, member.designation ?? member.role.charAt(0) + member.role.slice(1).toLowerCase().replace(/_/g, " "), staffCounts.get(member.id) ?? empty()),
    ),
  ];
}

export async function staffAttendanceTable(ctx: TenantContext, from: Date, to: Date): Promise<ReportTable> {
  const rows = await staffAttendanceReport(ctx, from, to);
  return {
    head: ["Employee ID", "Name", "Role", "Present", "Late", "Absent", "On leave", "Marked", "Attended %"],
    rows: rows.map((row) => [
      row.employeeId,
      row.name,
      row.job,
      row.counts.PRESENT,
      row.counts.LATE,
      row.counts.ABSENT,
      row.counts.ON_LEAVE,
      row.counts.total,
      row.share === null ? "" : Math.round(row.share * 100),
    ]),
  };
}

/** Every student's fee position this session; `pendingOnly` keeps those who still owe. */
export async function feePositionsTable(ctx: TenantContext, options: { pendingOnly?: boolean } = {}): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows: Array<Awaited<ReturnType<typeof listFeePositions>>["rows"][number]> = [];
  for (let page = 1; ; page += 1) {
    const result = await listFeePositions(ctx, { page });
    rows.push(...result.rows);
    if (page >= result.pageCount) break;
  }
  const kept = options.pendingOnly ? rows.filter((row) => row.summary.pendingMinor > 0) : rows;
  const rupees = (minor: number) => (minor / 100).toFixed(minor % 100 ? 2 : 0);

  return {
    head: ["Admission no.", "Student", "Class / section", "Roll no.", "Guardian", "Guardian phone", "Total fee (₹)", "Paid (₹)", "Pending (₹)", "Earliest due", "Overdue", "Status"],
    rows: kept.map((row) => [
      row.admissionNumber,
      row.name,
      row.section,
      row.rollNumber ?? "",
      row.parentName ?? "",
      row.parentPhone ?? "",
      rupees(row.summary.chargedMinor),
      rupees(row.summary.paidMinor),
      rupees(row.summary.pendingMinor),
      row.summary.dueOn ? formatDate(row.summary.dueOn) : "",
      row.summary.overdue ? "Yes" : "No",
      row.summary.status,
    ]),
  };
}

// -----------------------------------------------------------------------------
// Academic performance and teacher workload
// -----------------------------------------------------------------------------

/**
 * Every exam this session: how many sat it, the average percentage and the
 * pass rate, plus each subject's average across all exam papers. Computed from
 * the marks themselves with the same grading rules as the report card.
 */
export async function examPerformanceReport(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const sessionId = await currentSessionId(ctx);
  if (!sessionId) return { exams: [], subjects: [] };

  const exams = await ctx.db.exam.findMany({
    where: { academicSessionId: sessionId },
    orderBy: [{ startDate: "desc" }],
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
      papers: {
        select: {
          id: true,
          maxMarks: true,
          passMarks: true,
          date: true,
          subject: { select: { id: true, name: true } },
          results: { select: { assessmentId: true, studentId: true, marksObtained: true, absent: true, remarks: true } },
        },
      },
    },
  });

  const subjectShares = new Map<string, { name: string; shares: number[] }>();
  const rows = exams.map((exam) => {
    const studentIds = [...new Set(exam.papers.flatMap((paper) => paper.results.map((result) => result.studentId)))];
    const table = tabulate(
      exam.papers.map((paper) => ({ id: paper.id, subjectId: paper.subject.id, subject: paper.subject.name, maxMarks: paper.maxMarks, passMarks: paper.passMarks, date: paper.date, teacher: null })),
      studentIds.map((studentId) => ({ studentId, name: "", admissionNumber: "", rollNumber: null })),
      exam.papers.flatMap((paper) => paper.results),
    );
    for (const paper of exam.papers) {
      const entry = subjectShares.get(paper.subject.id) ?? { name: paper.subject.name, shares: [] };
      for (const result of paper.results) if (result.marksObtained !== null && paper.maxMarks > 0) entry.shares.push(result.marksObtained / paper.maxMarks);
      subjectShares.set(paper.subject.id, entry);
    }
    const complete = table.filter((row) => row.outcome !== "INCOMPLETE");
    const percents = complete.map((row) => row.percent).filter((value): value is number => value !== null);
    return {
      id: exam.id,
      name: exam.name,
      status: exam.status,
      section: sectionLabel(exam.section),
      students: complete.length,
      average: percents.length ? Math.round((percents.reduce((sum, value) => sum + value, 0) / percents.length) * 10) / 10 : null,
      passRate: complete.length ? complete.filter((row) => row.outcome === "PASS").length / complete.length : null,
    };
  });

  return {
    exams: rows,
    subjects: [...subjectShares.values()]
      .filter((entry) => entry.shares.length)
      .map((entry) => ({ subject: entry.name, papersMarked: entry.shares.length, average: Math.round((entry.shares.reduce((a, b) => a + b, 0) / entry.shares.length) * 1000) / 10 }))
      .sort((a, b) => a.average - b.average),
  };
}

export async function examPerformanceTable(ctx: TenantContext): Promise<ReportTable> {
  const { exams } = await examPerformanceReport(ctx);
  return {
    head: ["Exam", "Section", "Status", "Students with complete results", "Average %", "Pass %"],
    rows: exams.map((row) => [row.name, row.section, row.status, row.students, row.average ?? "", row.passRate === null ? "" : Math.round(row.passRate * 100)]),
  };
}

/**
 * What each teacher carries: periods a week, sections and subjects taught,
 * class-teacher duty, and — over the date range — classes written up, classes
 * missed, periods covered for others, and approved leave days.
 */
export async function teacherWorkloadReport(ctx: TenantContext, from: Date, to: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const sessionId = await currentSessionId(ctx);
  const [teachers, slots, assignments, sessions, covers, leave] = await Promise.all([
    ctx.db.teacher.findMany({
      where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, employeeId: true, classTeacherOf: sessionId ? { where: { academicSessionId: sessionId }, select: { id: true } } : { select: { id: true } } },
    }),
    sessionId ? ctx.db.timetableSlot.groupBy({ by: ["teacherId"], where: { academicSessionId: sessionId }, _count: { _all: true } }) : Promise.resolve([]),
    sessionId ? ctx.db.teacherSubjectAssignment.findMany({ where: { academicSessionId: sessionId }, select: { teacherId: true, sectionId: true, subjectId: true } }) : Promise.resolve([]),
    ctx.db.classSession.groupBy({ by: ["scheduledTeacherId", "status"], where: { date: { gte: from, lte: to } }, _count: { _all: true } }),
    ctx.db.classSession.groupBy({ by: ["actualTeacherId"], where: { date: { gte: from, lte: to }, status: "SUBSTITUTE", actualTeacherId: { not: null } }, _count: { _all: true } }),
    ctx.db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: to }, endDate: { gte: from }, teacherId: { not: null } }, select: { teacherId: true, startDate: true, endDate: true } }),
  ]);

  const periods = new Map(slots.map((row) => [row.teacherId, row._count._all]));
  const covered = new Map(covers.map((row) => [row.actualTeacherId!, row._count._all]));
  return teachers.map((teacher) => {
    const mine = assignments.filter((row) => row.teacherId === teacher.id);
    const count = (statuses: string[]) =>
      sessions.filter((row) => row.scheduledTeacherId === teacher.id && statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
    const leaveDays = leave
      .filter((row) => row.teacherId === teacher.id)
      .reduce((sum, row) => {
        const start = row.startDate > from ? row.startDate : from;
        const end = row.endDate < to ? row.endDate : to;
        return sum + Math.max(Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1, 0);
      }, 0);
    return {
      id: teacher.id,
      name: fullName(teacher),
      employeeId: teacher.employeeId,
      periodsPerWeek: periods.get(teacher.id) ?? 0,
      sections: new Set(mine.map((row) => row.sectionId)).size,
      subjects: new Set(mine.map((row) => row.subjectId)).size,
      classTeacher: teacher.classTeacherOf.length > 0,
      completed: count(["COMPLETED", "REMOTE"]),
      missed: count(["MISSED", "CANCELLED"]),
      coveredForOthers: covered.get(teacher.id) ?? 0,
      leaveDays,
    };
  });
}

export async function teacherWorkloadTable(ctx: TenantContext, from: Date, to: Date): Promise<ReportTable> {
  const rows = await teacherWorkloadReport(ctx, from, to);
  return {
    head: ["Employee ID", "Teacher", "Periods / week", "Sections", "Subjects", "Class teacher", "Classes written up", "Missed / cancelled", "Covered for others", "Leave days"],
    rows: rows.map((row) => [row.employeeId, row.name, row.periodsPerWeek, row.sections, row.subjects, row.classTeacher ? "Yes" : "No", row.completed, row.missed, row.coveredForOthers, row.leaveDays]),
  };
}

// -----------------------------------------------------------------------------
// Money and activity over a date range — read straight from the source rows.
// -----------------------------------------------------------------------------

const rupeesCell = (minor: number) => (minor / 100).toFixed(2);
const words = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");

/** Fee receipts in a range. Void receipts are listed, marked, and count for nothing. */
export async function feePaymentsTable(ctx: TenantContext, from: Date, to: Date): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.feePayment.findMany({
    where: { paidOn: { gte: from, lte: to } },
    orderBy: [{ paidOn: "asc" }, { receiptNo: "asc" }],
    select: {
      paidOn: true,
      receiptNo: true,
      amountMinor: true,
      method: true,
      referenceNo: true,
      voidedAt: true,
      voidReason: true,
      student: { select: { firstName: true, lastName: true, admissionNumber: true } },
    },
  });
  return {
    head: ["Date", "Receipt", "Student", "Admission no.", "Method", "Reference", "Amount (₹)", "Status"],
    rows: rows.map((row) => [
      formatDate(row.paidOn),
      row.receiptNo,
      fullName(row.student),
      row.student.admissionNumber,
      words(row.method),
      row.referenceNo ?? "",
      rupeesCell(row.amountMinor),
      row.voidedAt ? `Void${row.voidReason ? `: ${row.voidReason}` : ""}` : "Paid",
    ]),
  };
}

export async function expensesTable(ctx: TenantContext, from: Date, to: Date): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.expense.findMany({
    where: { spentOn: { gte: from, lte: to } },
    orderBy: { spentOn: "asc" },
    select: { spentOn: true, category: true, description: true, amountMinor: true, method: true, reference: true },
  });
  return {
    head: ["Date", "Category", "Description", "Method", "Reference", "Amount (₹)"],
    rows: rows.map((row) => [formatDate(row.spentOn), words(row.category), row.description, words(row.method), row.reference ?? "", rupeesCell(row.amountMinor)]),
  };
}

export async function salaryPaymentsTable(ctx: TenantContext, from: Date, to: Date): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.salaryPayment.findMany({
    where: { paidOn: { gte: from, lte: to } },
    orderBy: [{ paidOn: "asc" }],
    select: { paidOn: true, forMonth: true, amountMinor: true, method: true, reference: true, teacher: { select: { firstName: true, lastName: true, employeeId: true } } },
  });
  const month = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  return {
    head: ["Paid on", "For month", "Teacher", "Employee ID", "Method", "Reference", "Amount (₹)"],
    rows: rows.map((row) => [formatDate(row.paidOn), month.format(row.forMonth), fullName(row.teacher), row.teacher.employeeId, words(row.method), row.reference ?? "", rupeesCell(row.amountMinor)]),
  };
}

/** Classes taken by a substitute, and classes missed, in a range — from the class records. */
export async function substituteClassesTable(ctx: TenantContext, from: Date, to: Date): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.classSession.findMany({
    // A stand-in who marked the class remote or cancelled still took it over.
    where: { date: { gte: from, lte: to }, OR: [{ status: { in: ["SUBSTITUTE", "MISSED"] } }, { status: { in: ["REMOTE", "CANCELLED"] }, actualTeacherId: { not: null } }] },
    orderBy: [{ date: "asc" }],
    select: {
      date: true,
      status: true,
      scheduledTeacherId: true,
      actualTeacherId: true,
      topic: true,
      scheduledTeacher: { select: { firstName: true, lastName: true } },
      actualTeacher: { select: { firstName: true, lastName: true } },
      timetableSlot: { select: { startMinute: true, subject: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } } },
    },
  });
  const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return {
    head: ["Date", "Time", "Class", "Subject", "Timetabled teacher", "Taken by", "Status", "Topic"],
    rows: rows
      .filter((row) => row.status === "SUBSTITUTE" || row.status === "MISSED" || row.actualTeacherId !== row.scheduledTeacherId)
      .map((row) => [
        formatDate(row.date),
        time(row.timetableSlot.startMinute),
        sectionLabel(row.timetableSlot.section),
        row.timetableSlot.subject.name,
        fullName(row.scheduledTeacher),
        row.actualTeacher && row.actualTeacherId !== row.scheduledTeacherId ? fullName(row.actualTeacher) : row.status === "MISSED" ? "—" : fullName(row.scheduledTeacher),
        words(row.status),
        row.topic ?? "",
      ]),
  };
}

/** Homework set in a range, by section and subject. */
export async function homeworkTable(ctx: TenantContext, from: Date, to: Date): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.homework.findMany({
    where: { assignedOn: { gte: from, lte: to } },
    orderBy: [{ assignedOn: "asc" }],
    select: {
      assignedOn: true,
      dueOn: true,
      title: true,
      status: true,
      subject: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
    },
  });
  return {
    head: ["Set on", "Due", "Class", "Subject", "Teacher", "Title", "Status"],
    rows: rows.map((row) => [formatDate(row.assignedOn), formatDate(row.dueOn), sectionLabel(row.section), row.subject.name, fullName(row.teacher), row.title, words(row.status)]),
  };
}

/** Support records this session — staff-only detail, never shown to families. */
export async function supportTable(ctx: TenantContext): Promise<ReportTable> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const sessionId = await currentSessionId(ctx);
  const rows = sessionId
    ? await ctx.db.studentSupport.findMany({
        where: { academicSessionId: sessionId },
        orderBy: [{ createdAt: "asc" }],
        select: {
          createdAt: true,
          status: true,
          reason: true,
          action: true,
          priority: true,
          resolvedAt: true,
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
          section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
          subject: { select: { name: true } },
          teacher: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  return {
    head: ["Opened", "Student", "Admission no.", "Class", "Subject", "Teacher", "Reason", "Action", "Priority", "Status", "Resolved"],
    rows: rows.map((row) => [
      formatDate(row.createdAt),
      fullName(row.student),
      row.student.admissionNumber,
      sectionLabel(row.section),
      row.subject?.name ?? "",
      row.teacher ? fullName(row.teacher) : "",
      words(row.reason),
      words(row.action),
      words(row.priority),
      words(row.status),
      row.resolvedAt ? formatDate(row.resolvedAt) : "",
    ]),
  };
}
