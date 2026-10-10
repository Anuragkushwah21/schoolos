import "server-only";

import { assertNotDemo } from "@/server/demo/guard";

import type { Prisma } from "@/generated/prisma/client";
import { campusAllowanceText, quote } from "@/lib/plan-catalog";
import { PUBLIC_PLAN_SELECT, presentPublicPlan } from "@/server/platform/marketing";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { cleanRoles } from "@/lib/school-roles";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { campusCount, campusLimitOf, ensureOrganization } from "@/server/platform/campuses";
import { currentPlanOf, planLimits } from "@/server/platform/entitlements";
import { setSubscription } from "@/server/platform/schools";

/**
 * Upgrade Plan. SchoolOS has no online payment yet, so choosing a plan is a
 * request: the school's plan, modules, roles, limits and campus entitlement do
 * not change until the Super Admin approves it — then the subscription moves to
 * the plan (through `setSubscription`, the same path the Super Admin uses).
 * One open request per school at a time.
 */

function presentPlan(plan: Prisma.PlanGetPayload<{ select: typeof PUBLIC_PLAN_SELECT & { roleLimits: true; availableRoles: true; isActive: true; status: true } }>, campuses: number) {
  const base = presentPublicPlan(plan);
  return { ...base, roles: cleanRoles(plan.availableRoles), limits: planLimits(plan), multiCampus: plan.campusLimit > 1 || plan.extraCampusAllowed, quote: quote(base, campuses), allowance: campusAllowanceText(base) };
}

const OVERVIEW_SELECT = { ...PUBLIC_PLAN_SELECT, roleLimits: true, availableRoles: true, isActive: true, status: true } as const;

/**
 * What the Plan & billing page shows: the current plan and entitlement, the
 * published plans with a full price breakdown for this organization's
 * campuses, and requests. SchoolOS has no payment gateway — a price shown is
 * what SchoolOS will bill after approval, never a charge already taken.
 */
export async function planOverview(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const schoolId = ctx.user.homeSchoolId ?? ctx.schoolId;
  const organizationId = await ensureOrganization(schoolId);
  const [current, plans, requests, campus, campuses] = await Promise.all([
    currentPlanOf(schoolId),
    prisma.plan.findMany({ where: { isActive: true, status: "PUBLISHED" }, orderBy: [{ displayOrder: "asc" }, { priceMinor: "asc" }], select: OVERVIEW_SELECT }),
    prisma.planChangeRequest.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, status: true, note: true, reviewNote: true, rejectionReason: true, createdAt: true, reviewedAt: true, requestedPlan: { select: { name: true } }, currentPlan: { select: { name: true } } },
    }),
    campusLimitOf(organizationId),
    campusCount(organizationId),
  ]);
  // The current plan is shown even when it is closed or archived for new customers.
  const currentRow = current ? await prisma.plan.findUnique({ where: { id: current.id }, select: OVERVIEW_SELECT }) : null;
  return {
    current: currentRow ? presentPlan(currentRow, campuses) : null,
    plans: plans.map((plan) => presentPlan(plan, campuses)),
    requests,
    open: requests.find((request) => request.status === "PENDING") ?? null,
    campus: { limit: campus.limit, included: campus.included, used: campuses, overridden: campus.overridden },
  };
}

export async function requestPlanChange(ctx: TenantContext, input: { planId: string; note: string | null }) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  assertNotDemo(ctx.user, "Plan changes");
  const schoolId = ctx.user.homeSchoolId ?? ctx.schoolId;
  const [plan, current, open] = await Promise.all([
    prisma.plan.findFirst({ where: { id: input.planId, isActive: true, status: "PUBLISHED" }, select: { id: true, name: true } }),
    currentPlanOf(schoolId),
    prisma.planChangeRequest.findFirst({ where: { schoolId, status: "PENDING" }, select: { id: true } }),
  ]);
  if (!plan) throw new NotFoundError("That plan is not offered.");
  if (current?.id === plan.id) throw new ConflictError(`You are already on the ${plan.name} plan.`);
  if (open) throw new ConflictError("You already have a plan request waiting for SchoolOS. Cancel it first to choose another plan.");
  const row = await prisma.planChangeRequest.create({ data: { schoolId, currentPlanId: current?.id ?? null, requestedPlanId: plan.id, requestedById: ctx.user.id, note: input.note }, select: { id: true } });
  await recordAudit({ action: "PLAN_CHANGE_REQUESTED", entityType: "PlanChangeRequest", entityId: row.id, schoolId, actorId: ctx.user.id, summary: `Asked to move from ${current?.name ?? "no plan"} to ${plan.name}. Nothing changes until SchoolOS approves.`, metadata: { from: current?.id ?? null, to: plan.id } });
  return row;
}

export async function cancelPlanChange(ctx: TenantContext, requestId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const schoolId = ctx.user.homeSchoolId ?? ctx.schoolId;
  const { count } = await prisma.planChangeRequest.updateMany({ where: { id: requestId, schoolId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (!count) throw new NotFoundError("That request is not waiting any more.");
  await recordAudit({ action: "PLAN_CHANGE_CANCELLED", entityType: "PlanChangeRequest", entityId: requestId, schoolId, actorId: ctx.user.id, summary: "Plan request withdrawn." });
}

// --- Super Admin ------------------------------------------------------------

export async function listPlanChangeRequests(actor: SessionUser, status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | null) {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.planChangeRequest.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      note: true,
      reviewNote: true,
      rejectionReason: true,
      createdAt: true,
      school: { select: { id: true, name: true, city: true, organization: { select: { name: true } } } },
      currentPlan: { select: { name: true } },
      requestedPlan: { select: { id: true, name: true, campusLimit: true } },
      requestedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}

/** Approve: only now does the school's subscription move to the plan. */
export async function approvePlanChange(actor: SessionUser, requestId: string, reviewNote: string | null) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.planChangeRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true, schoolId: true, requestedPlanId: true, requestedPlan: { select: { name: true } } } });
  if (!row) throw new NotFoundError();
  // Claim it first, so a double approval changes the plan once.
  const { count } = await prisma.planChangeRequest.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date(), reviewNote } });
  if (!count) throw new ConflictError("This request is no longer waiting.");
  // One plan for the organization: `setSubscription` moves every campus
  // together, in one transaction. If it fails, the request goes back to
  // waiting — never "approved" with the old plan still in place.
  try {
    await setSubscription(actor, { schoolId: row.schoolId, planId: row.requestedPlanId, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: `Plan request ${row.id.slice(-8).toUpperCase()} approved.` });
  } catch (error) {
    await prisma.planChangeRequest.updateMany({ where: { id: row.id, status: "APPROVED" }, data: { status: "PENDING", reviewedById: null, reviewedAt: null, reviewNote: null } });
    throw error;
  }
  await recordAudit({ action: "PLAN_CHANGE_APPROVED", entityType: "PlanChangeRequest", entityId: row.id, schoolId: row.schoolId, actorId: actor.id, summary: `Plan request approved: now on ${row.requestedPlan.name}.${reviewNote ? ` ${reviewNote}` : ""}` });
}

export async function rejectPlanChange(actor: SessionUser, requestId: string, reason: string) {
  assertRole(actor, "SUPER_ADMIN");
  if (!reason.trim()) throw new ConflictError("Give a reason — the school is told why.");
  const row = await prisma.planChangeRequest.findUnique({ where: { id: requestId }, select: { id: true, schoolId: true } });
  if (!row) throw new NotFoundError();
  const { count } = await prisma.planChangeRequest.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "REJECTED", rejectionReason: reason, reviewedById: actor.id, reviewedAt: new Date() } });
  if (!count) throw new ConflictError("This request is no longer waiting.");
  await recordAudit({ action: "PLAN_CHANGE_REJECTED", entityType: "PlanChangeRequest", entityId: row.id, schoolId: row.schoolId, actorId: actor.id, summary: `Plan request rejected: ${reason}`, metadata: { reason } });
}
