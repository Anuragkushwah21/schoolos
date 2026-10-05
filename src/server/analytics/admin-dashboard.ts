import "server-only";

import { addDays, schoolInstant, today } from "@/lib/dates";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { classStrength } from "@/server/analytics/school";
import { needsAttentionCount } from "@/server/exams/attention";
import { listExams, testCounts } from "@/server/exams/service";
import { listFeePositions } from "@/server/finance/fees";

/**
 * The School Admin dashboard's figures, one small function per section so
 * each section loads (and streams) on its own. Everything is a count or a
 * sum straight from the rows — nothing is stored or estimated.
 */

/** Midnight in the school's time zone, as a timestamp, for "created today" counts. */
function startOfToday(): Date {
  return schoolInstant(today(), 0);
}

/** Family enquiries and public applications received, and students admitted, today. */
export async function admissionsToday(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const since = startOfToday();
  const [enquiries, applications, admitted] = await Promise.all([
    ctx.db.enquiry.count({ where: { createdAt: { gte: since } } }),
    ctx.db.admissionApplication.count({ where: { submittedAt: { gte: since } } }),
    ctx.db.student.count({ where: { createdAt: { gte: since } } }),
  ]);
  return { enquiries, applications, admitted };
}

export type StudentBand = { key: string; label: string; value: number };

/** Current students by stage: Nursery–5, 6–8, 9–12 (class order: Nursery −3 … Class 12). */
export async function studentBands(ctx: TenantContext, academicSessionId: string): Promise<StudentBand[]> {
  const rows = await classStrength(ctx, academicSessionId);
  const band = (min: number, max: number) => rows.filter((row) => row.level >= min && row.level <= max).reduce((sum, row) => sum + row.value, 0);
  const bands: StudentBand[] = [
    { key: "primary", label: "Nursery – Class 5", value: band(-10, 5) },
    { key: "middle", label: "Class 6 – 8", value: band(6, 8) },
    { key: "senior", label: "Class 9 – 12", value: band(9, 12) },
  ];
  const other = rows.filter((row) => row.level > 12).reduce((sum, row) => sum + row.value, 0);
  return other ? [...bands, { key: "other", label: "Other classes", value: other }] : bands;
}

/** Teachers and other staff, and how many are on approved leave today. */
export async function staffToday(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const date = today();
  const [teachers, staff, onLeave] = await Promise.all([
    ctx.db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
    ctx.db.staffMember.count({ where: { status: { in: [...CURRENT_EMPLOYEE] } } }),
    ctx.db.leaveRequest.count({ where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } } }),
  ]);
  return { teachers, staff, onLeave };
}

/** The academic picture: who needs attention, marks to chase, results to release, exams coming. */
export async function academicSnapshot(ctx: TenantContext, academicSessionId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const date = today();
  const [attention, counts, exams, upcomingExams, upcomingTests] = await Promise.all([
    needsAttentionCount(ctx),
    testCounts(ctx),
    listExams(ctx, { academicSessionId }),
    ctx.db.exam.findMany({
      where: { academicSessionId, startDate: { gte: date, lte: addDays(date, 14) } },
      orderBy: { startDate: "asc" },
      distinct: ["name"],
      select: { name: true, startDate: true },
    }),
    ctx.db.assessment.count({ where: { academicSessionId, examId: null, date: { gt: date, lte: addDays(date, 14) } } }),
  ]);
  return {
    needsAttention: attention,
    pendingMarks: counts.pending,
    readyToPublish: exams.filter((exam) => exam.stage === "READY_TO_PUBLISH").length,
    upcomingExams: upcomingExams.length,
    nextExam: upcomingExams[0] ?? null,
    upcomingTests,
  };
}

const MONTHS = 6;

/**
 * Money: today's collection and expenses, what this session has collected,
 * what is still pending (and how much of it is overdue), and the last six
 * months of fees against expenses.
 */
export async function financeSnapshot(ctx: TenantContext, academicSessionId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const date = today();
  const firstMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - (MONTHS - 1), 1));
  const [collectedToday, expensesToday, collectedSession, positions, fees, expenses] = await Promise.all([
    ctx.db.feePayment.aggregate({ where: { paidOn: date, voidedAt: null }, _sum: { amountMinor: true } }),
    ctx.db.expense.aggregate({ where: { spentOn: date }, _sum: { amountMinor: true } }),
    ctx.db.feePayment.aggregate({ where: { academicSessionId, voidedAt: null }, _sum: { amountMinor: true } }),
    listFeePositions(ctx, { academicSessionId }),
    ctx.db.feePayment.findMany({ where: { paidOn: { gte: firstMonth }, voidedAt: null }, select: { paidOn: true, amountMinor: true } }),
    ctx.db.expense.findMany({ where: { spentOn: { gte: firstMonth } }, select: { spentOn: true, amountMinor: true } }),
  ]);
  const months = Array.from({ length: MONTHS }, (_, index) => {
    const start = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1));
    return { key: `${start.getUTCFullYear()}-${start.getUTCMonth()}`, label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(start), fees: 0, expenses: 0 };
  });
  const slot = (when: Date) => months.find((month) => month.key === `${when.getUTCFullYear()}-${when.getUTCMonth()}`);
  for (const row of fees) {
    const month = slot(row.paidOn);
    if (month) month.fees += row.amountMinor;
  }
  for (const row of expenses) {
    const month = slot(row.spentOn);
    if (month) month.expenses += row.amountMinor;
  }
  return {
    collectedTodayMinor: collectedToday._sum.amountMinor ?? 0,
    expensesTodayMinor: expensesToday._sum.amountMinor ?? 0,
    collectedSessionMinor: collectedSession._sum.amountMinor ?? 0,
    pendingMinor: positions.totals?.pendingMinor ?? 0,
    overdueStudents: positions.totals?.overdue ?? 0,
    studentsWithDues: positions.rows.length ? positions.totals!.students : 0,
    months,
  };
}
