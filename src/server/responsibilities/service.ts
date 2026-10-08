import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { addDays, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { can, isSchoolLeader } from "@/lib/permissions";
import { ASSIGNABLE_ROLES, effectiveStatus, responsibilityTypeLabel } from "@/lib/responsibilities";
import type { ResponsibilityCreateInput, ResponsibilityUpdateInput } from "@/lib/validation/responsibilities";
import { recordAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";
import { prisma } from "@/server/db/prisma";

/**
 * Responsibilities: the Principal (or School Admin) hands a duty to a teacher
 * or staff member, the assignee starts it, notes progress and marks it done,
 * and the assigner reviews and confirms it.
 *
 *   * Assigning, editing, reassigning, cancelling and confirming need the
 *     "responsibilities" area in lib/permissions.ts — the School Admin and the
 *     Principal. The School Admin sees and manages every record; a Principal
 *     cannot manage (edit, cancel, confirm) one given to themselves.
 *   * The assignee works on their own records only.
 *   * A responsibility is never a permission: nothing here changes what anyone
 *     can open or do elsewhere.
 *   * Everything goes through `ctx.db`, so another school's records are never
 *     reached; the assignee is checked to belong to this school.
 */

const SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  status: true,
  priority: true,
  startDate: true,
  endDate: true,
  notes: true,
  progressNote: true,
  completedAt: true,
  confirmedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  assignedToId: true,
  assignedById: true,
  assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
  assignedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
} as const;

type Row = Prisma.ResponsibilityGetPayload<{ select: typeof SELECT }>;

function present(row: Row, now: Date) {
  return {
    ...row,
    typeLabel: responsibilityTypeLabel(row.type),
    shownStatus: effectiveStatus(row, now),
    assignedToName: fullName(row.assignedTo),
    assignedByName: row.assignedBy ? fullName(row.assignedBy) : null,
  };
}
export type ResponsibilityRow = ReturnType<typeof present>;

const OPEN = ["PENDING", "IN_PROGRESS", "OVERDUE"] as const;

/** The views a leader can filter by. */
export const RESPONSIBILITY_VIEWS = ["all", "mine", "assigned", "pending", "overdue", "completed", "cancelled"] as const;
export type ResponsibilityView = (typeof RESPONSIBILITY_VIEWS)[number];

function viewWhere(ctx: TenantContext, view: ResponsibilityView, now: Date): Prisma.ResponsibilityWhereInput {
  switch (view) {
    case "mine":
      return { assignedToId: ctx.user.id };
    case "assigned":
      return { assignedById: ctx.user.id };
    case "pending":
      return { status: { in: [...OPEN] }, OR: [{ endDate: null }, { endDate: { gte: now } }] };
    case "overdue":
      return { status: { in: [...OPEN] }, endDate: { lt: now } };
    case "completed":
      return { status: "COMPLETED" };
    case "cancelled":
      return { status: "CANCELLED" };
    default:
      return {};
  }
}

/** Every record in the school, filtered — for the School Admin and the Principal. */
export async function listResponsibilities(ctx: TenantContext, view: ResponsibilityView = "all") {
  assertCan(ctx, "responsibilities", "VIEW");
  const now = today();
  const rows = await ctx.db.responsibility.findMany({
    where: viewWhere(ctx, view, now),
    orderBy: [{ endDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 300,
    select: SELECT,
  });
  return rows.map((row) => present(row, now));
}

/** Counts for the filter tabs and dashboards. `forUserId` limits to one person's records. */
export async function responsibilityCounts(ctx: TenantContext, where: Prisma.ResponsibilityWhereInput = {}) {
  const now = today();
  const recent = addDays(now, -30);
  const [open, overdue, inProgress, completed, recentlyCompleted, cancelled] = await Promise.all([
    ctx.db.responsibility.count({ where: { ...where, status: { in: [...OPEN] }, OR: [{ endDate: null }, { endDate: { gte: now } }] } }),
    ctx.db.responsibility.count({ where: { ...where, status: { in: [...OPEN] }, endDate: { lt: now } } }),
    ctx.db.responsibility.count({ where: { ...where, status: "IN_PROGRESS", OR: [{ endDate: null }, { endDate: { gte: now } }] } }),
    ctx.db.responsibility.count({ where: { ...where, status: "COMPLETED" } }),
    ctx.db.responsibility.count({ where: { ...where, status: "COMPLETED", completedAt: { gte: recent } } }),
    ctx.db.responsibility.count({ where: { ...where, status: "CANCELLED" } }),
  ]);
  return { pending: open, overdue, inProgress, completed, recentlyCompleted, cancelled, awaitingReview: 0 };
}

/** The leader's summary: everything, mine, the ones I gave, and completed work waiting for review. */
export async function responsibilitySummary(ctx: TenantContext) {
  assertCan(ctx, "responsibilities", "VIEW");
  const [all, mine, assigned, awaitingReview] = await Promise.all([
    responsibilityCounts(ctx),
    responsibilityCounts(ctx, { assignedToId: ctx.user.id }),
    responsibilityCounts(ctx, { assignedById: ctx.user.id }),
    ctx.db.responsibility.count({ where: { status: "COMPLETED", confirmedAt: null, assignedToId: { not: ctx.user.id } } }),
  ]);
  return { all: { ...all, awaitingReview }, mine, assigned };
}

/** My own responsibilities — any signed-in member of the school. */
export async function myResponsibilities(ctx: TenantContext, includeClosed = true) {
  const now = today();
  const rows = await ctx.db.responsibility.findMany({
    where: { assignedToId: ctx.user.id, ...(includeClosed ? {} : { status: { in: [...OPEN] } }) },
    orderBy: [{ endDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    select: SELECT,
  });
  return rows.map((row) => present(row, now));
}

/** How many of my own are still open (and how many of those are overdue), for a dashboard card. */
export async function myResponsibilityCounts(ctx: TenantContext) {
  return responsibilityCounts(ctx, { assignedToId: ctx.user.id });
}

/** People who can be given a responsibility: this school's teachers, staff and Principal, with an open login. */
export async function assignablePeople(ctx: TenantContext) {
  assertCan(ctx, "responsibilities", "CREATE");
  const users = await prisma.user.findMany({
    where: { schoolId: ctx.schoolId, isActive: true, role: { in: [...ASSIGNABLE_ROLES] }, id: { not: ctx.user.id } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, role: true, staffMember: { select: { role: true } } },
  });
  return users.map((user) => ({
    id: user.id,
    name: fullName(user),
    role: user.role,
    label: `${fullName(user)} · ${user.role === "TEACHER" ? "Teacher" : user.role === "PRINCIPAL" ? "Principal" : "Staff"}`,
  }));
}

/** The assignee must be one of this school's teachers, staff or Principal — never a parent, student or another school's user. */
async function assertAssignee(ctx: TenantContext, userId: string) {
  if (userId === ctx.user.id) throw new ValidationError("Choose someone else to give this to.", { assignedToId: ["Choose someone else"] });
  const user = await prisma.user.findFirst({ where: { id: userId, schoolId: ctx.schoolId, isActive: true, role: { in: [...ASSIGNABLE_ROLES] } }, select: { id: true, firstName: true, lastName: true } });
  if (!user) throw new ValidationError("Choose a teacher or staff member of this school.", { assignedToId: ["Choose a teacher or staff member"] });
  return user;
}

async function findOne(ctx: TenantContext, id: string) {
  const row = await ctx.db.responsibility.findFirst({ where: { id }, select: SELECT });
  if (!row) throw new NotFoundError();
  return row;
}

/** A leader manages a record — but a Principal never their own (the School Admin reviews those). */
async function managed(ctx: TenantContext, id: string, action: "EDIT" | "APPROVE") {
  assertCan(ctx, "responsibilities", action);
  const row = await findOne(ctx, id);
  if (row.assignedToId === ctx.user.id && ctx.user.role !== "SCHOOL_ADMIN") throw new ForbiddenError("The School Admin manages responsibilities given to you.");
  return row;
}

const audit = (ctx: TenantContext, action: Parameters<typeof recordAudit>[0]["action"], id: string, summary: string, metadata?: Record<string, unknown>) =>
  recordAudit({ action, actorId: ctx.user.id, schoolId: ctx.schoolId, entityType: "Responsibility", entityId: id, summary, metadata });

export async function createResponsibility(ctx: TenantContext, input: ResponsibilityCreateInput) {
  assertCan(ctx, "responsibilities", "CREATE");
  const assignee = await assertAssignee(ctx, input.assignedToId);
  const row = await ctx.db.responsibility.create({
    data: {
      schoolId: ctx.schoolId,
      title: input.title,
      description: input.description,
      type: input.type,
      assignedToId: assignee.id,
      assignedById: ctx.user.id,
      startDate: input.startDate,
      endDate: input.endDate,
      priority: input.priority,
      notes: input.notes,
    },
    select: { id: true },
  });
  await audit(ctx, "RESPONSIBILITY_ASSIGNED", row.id, `Gave "${input.title}" (${responsibilityTypeLabel(input.type)}) to ${fullName(assignee)}`, { assignedToId: assignee.id });
  return row;
}

/** Edit the details; choosing another person reassigns it, and its progress starts afresh. */
export async function updateResponsibility(ctx: TenantContext, input: ResponsibilityUpdateInput) {
  const row = await managed(ctx, input.responsibilityId, "EDIT");
  if (row.status === "CANCELLED") throw new ConflictError("This responsibility was cancelled.");
  const reassigned = input.assignedToId !== row.assignedToId;
  const assignee = reassigned ? await assertAssignee(ctx, input.assignedToId) : null;
  await ctx.db.responsibility.update({
    where: { id: row.id },
    data: {
      title: input.title,
      description: input.description,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      priority: input.priority,
      notes: input.notes,
      ...(assignee ? { assignedToId: assignee.id, status: "PENDING", progressNote: null, completedAt: null, confirmedAt: null } : {}),
    },
  });
  if (assignee) {
    await audit(ctx, "RESPONSIBILITY_REASSIGNED", row.id, `Moved "${input.title}" from ${fullName(row.assignedTo)} to ${fullName(assignee)}`, { from: row.assignedToId, to: assignee.id });
  } else {
    await audit(ctx, "RESPONSIBILITY_UPDATED", row.id, `Edited "${input.title}"`);
  }
}

export async function cancelResponsibility(ctx: TenantContext, id: string) {
  const row = await managed(ctx, id, "EDIT");
  if (row.status === "CANCELLED") return;
  if (row.status === "COMPLETED") throw new ConflictError("This is already completed.");
  await ctx.db.responsibility.update({ where: { id: row.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await audit(ctx, "RESPONSIBILITY_CANCELLED", row.id, `Cancelled "${row.title}" (${fullName(row.assignedTo)})`);
}

/** Review completed work and confirm it. */
export async function confirmResponsibility(ctx: TenantContext, id: string) {
  const row = await managed(ctx, id, "APPROVE");
  if (row.status !== "COMPLETED") throw new ConflictError("Only completed work can be confirmed.");
  if (row.confirmedAt) return;
  await ctx.db.responsibility.update({ where: { id: row.id }, data: { confirmedAt: new Date() } });
  await audit(ctx, "RESPONSIBILITY_CONFIRMED", row.id, `Confirmed "${row.title}" done by ${fullName(row.assignedTo)}`);
}

/** Send completed work back to the assignee as in progress. */
export async function reopenResponsibility(ctx: TenantContext, id: string) {
  const row = await managed(ctx, id, "APPROVE");
  if (row.status !== "COMPLETED") throw new ConflictError("Only completed work can be sent back.");
  await ctx.db.responsibility.update({ where: { id: row.id }, data: { status: "IN_PROGRESS", completedAt: null, confirmedAt: null } });
  await audit(ctx, "RESPONSIBILITY_UPDATED", row.id, `Sent "${row.title}" back to ${fullName(row.assignedTo)}`);
}

/** The assignee's own record, still open. Anyone else gets "not found". */
async function ownOpen(ctx: TenantContext, id: string) {
  const row = await ctx.db.responsibility.findFirst({ where: { id, assignedToId: ctx.user.id }, select: SELECT });
  if (!row) throw new NotFoundError();
  if (row.status === "CANCELLED") throw new ConflictError("This responsibility was cancelled.");
  if (row.status === "COMPLETED") throw new ConflictError("This is already marked completed.");
  return row;
}

export async function startResponsibility(ctx: TenantContext, id: string) {
  const row = await ownOpen(ctx, id);
  if (row.status === "IN_PROGRESS") return;
  await ctx.db.responsibility.update({ where: { id: row.id }, data: { status: "IN_PROGRESS" } });
  await audit(ctx, "RESPONSIBILITY_STARTED", row.id, `Started "${row.title}"`);
}

export async function updateResponsibilityProgress(ctx: TenantContext, id: string, progressNote: string) {
  const row = await ownOpen(ctx, id);
  await ctx.db.responsibility.update({ where: { id: row.id }, data: { progressNote, status: "IN_PROGRESS" } });
  await audit(ctx, "RESPONSIBILITY_PROGRESS", row.id, `Progress on "${row.title}"`, { progressNote });
}

export async function completeResponsibility(ctx: TenantContext, id: string) {
  const row = await ownOpen(ctx, id);
  await ctx.db.responsibility.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await audit(ctx, "RESPONSIBILITY_COMPLETED", row.id, `Completed "${row.title}"`);
}

/** Whether this person can manage records (assign, review) — for showing the controls. */
export function canManageResponsibilities(ctx: TenantContext) {
  return can(ctx.user.role, "responsibilities", "CREATE") && isSchoolLeader(ctx.user.role);
}

/** A short list for a summary card (e.g. the Principal workspace). */
export async function recentResponsibilities(ctx: TenantContext, where: Prisma.ResponsibilityWhereInput, take = 8) {
  assertCan(ctx, "responsibilities", "VIEW");
  const now = today();
  const rows = await ctx.db.responsibility.findMany({ where, orderBy: { updatedAt: "desc" }, take, select: SELECT });
  return rows.map((row) => present(row, now));
}
