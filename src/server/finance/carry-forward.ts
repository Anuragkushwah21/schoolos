import "server-only";

import { today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { requireCurrentSession } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { isUniqueViolation } from "@/server/db/errors";
import { readStudentFees } from "@/server/finance/fees";

/**
 * Previous sessions' unpaid balances.
 *
 * Fees belong to a session, so when a child moves from Class 8 to Class 9
 * last year's balance does not silently merge into this year's. It stays
 * visible as "Previous outstanding (2025-26)" — and the office can choose to
 * "Carry forward outstanding": one explicit charge in this session, linked to
 * the session it came from, after which the old session shows it as carried
 * forward rather than owed twice.
 */

export type PreviousDue = {
  sessionId: string;
  sessionName: string;
  pendingMinor: number;
};

/** Earlier sessions in which this student still owes money (after anything already carried forward). */
export async function previousDues(ctx: TenantContext, studentId: string): Promise<PreviousDue[]> {
  const current = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true, startDate: true } });
  if (!current) return [];
  const sessions = await ctx.db.academicSession.findMany({
    where: { startDate: { lt: current.startDate }, feeCharges: { some: { studentId } } },
    orderBy: { startDate: "asc" },
    select: { id: true, name: true },
  });
  const dues: PreviousDue[] = [];
  for (const session of sessions) {
    const { summary } = await readStudentFees(ctx, studentId, session.id);
    if (summary.pendingMinor > 0) dues.push({ sessionId: session.id, sessionName: session.name, pendingMinor: summary.pendingMinor });
  }
  return dues;
}

/**
 * Carry one earlier session's balance into the current session. School Admin
 * only. The new charge is under a system head named for its source session,
 * so the parent reads exactly why it is owed.
 */
export async function carryForward(ctx: TenantContext, studentId: string, fromSessionId: string): Promise<{ amountMinor: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const current = await requireCurrentSession(ctx);
  const [student, from] = await Promise.all([
    ctx.db.student.findFirst({ where: { id: studentId }, select: { id: true, firstName: true, lastName: true } }),
    ctx.db.academicSession.findFirst({ where: { id: fromSessionId }, select: { id: true, name: true, startDate: true } }),
  ]);
  if (!student || !from) throw new NotFoundError();
  const currentStart = (await ctx.db.academicSession.findFirst({ where: { id: current.id }, select: { startDate: true } }))!.startDate;
  if (from.id === current.id || from.startDate >= currentStart) throw new AppError("VALIDATION", "Only an earlier session's balance can be carried forward.");

  const { summary } = await readStudentFees(ctx, studentId, from.id);
  if (summary.pendingMinor <= 0) throw new ConflictError(`Nothing is outstanding for ${from.name}.`);
  const amountMinor = summary.pendingMinor;

  try {
    await ctx.db.$transaction(async (tx) => {
      const headName = `Previous outstanding (${from.name})`;
      const head =
        (await tx.feeHead.findFirst({ where: { schoolId: ctx.schoolId, name: headName }, select: { id: true } })) ??
        (await tx.feeHead.create({
          data: { schoolId: ctx.schoolId, name: headName, note: `Unpaid balance carried from ${from.name}.`, isSystem: true, isActive: false },
          select: { id: true },
        }));
      const charge = await tx.feeCharge.create({
        data: {
          schoolId: ctx.schoolId,
          academicSessionId: current.id,
          studentId,
          feeHeadId: head.id,
          amountMinor,
          dueOn: today(),
          notes: `Carried forward from ${from.name}.`,
        },
        select: { id: true },
      });
      await tx.feeCarryForward.create({
        data: { schoolId: ctx.schoolId, studentId, fromSessionId: from.id, toSessionId: current.id, amountMinor, feeChargeId: charge.id, createdById: ctx.user.id },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`${from.name}'s balance has already been carried forward.`);
    throw error;
  }
  await recordAudit({
    action: "FEE_CARRIED_FORWARD",
    entityType: "Student",
    entityId: studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(student)}: ₹${(amountMinor / 100).toLocaleString("en-IN")} outstanding from ${from.name} carried forward to ${current.name}.`,
  });
  return { amountMinor };
}

/**
 * Students of the current session who still owe an earlier session's fees,
 * not yet carried forward — the office's "Carry forward" list. Optionally
 * one section.
 */
export async function carryForwardCandidates(ctx: TenantContext, filters: { sectionId?: string } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const current = await requireCurrentSession(ctx);
  const enrollments = await ctx.db.studentEnrollment.findMany({
    where: { academicSessionId: current.id, status: "ACTIVE", ...(filters.sectionId ? { sectionId: filters.sectionId } : {}) },
    select: {
      student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  });
  const rows = [];
  for (const row of enrollments) {
    const dues = await previousDues(ctx, row.student.id);
    if (dues.length) {
      rows.push({
        studentId: row.student.id,
        name: fullName(row.student),
        admissionNumber: row.student.admissionNumber,
        section: `${row.section.class.name} – ${row.section.name}`,
        dues,
        totalMinor: dues.reduce((sum, due) => sum + due.pendingMinor, 0),
      });
    }
  }
  return rows.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
}

/** Carry forward every listed balance for one section (or the school). Reports what was done. */
export async function carryForwardAll(ctx: TenantContext, filters: { sectionId?: string } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const candidates = await carryForwardCandidates(ctx, filters);
  let students = 0;
  let amountMinor = 0;
  const skipped: string[] = [];
  for (const row of candidates) {
    let moved = false;
    for (const due of row.dues) {
      try {
        amountMinor += (await carryForward(ctx, row.studentId, due.sessionId)).amountMinor;
        moved = true;
      } catch (error) {
        if (error instanceof ConflictError) skipped.push(`${row.name} (${due.sessionName})`);
        else throw error;
      }
    }
    if (moved) students += 1;
  }
  return { students, amountMinor, skipped };
}
