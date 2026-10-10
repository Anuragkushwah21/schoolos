import "server-only";

import type { FeatureReleaseScope, FeatureRequestPriority, FeatureRequestStatus } from "@/generated/prisma/enums";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { CORE_MODULES, OPTIONAL_MODULES } from "@/lib/school-modules";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { assertNotDemo } from "@/server/demo/guard";
import { ensureOrganization } from "@/server/platform/campuses";
import { assertPlanFeature } from "@/server/platform/entitlements";

/**
 * Custom feature requests. The owner asks (when the plan includes custom
 * feature requests); the Super Admin evaluates, agrees cost, scope and a
 * timeline, and tracks the work to release. What a released feature becomes
 * — one customer's customization, an optional module, a standard feature or
 * a paid add-on — is the Super Admin's explicit decision; nobody else on the
 * same plan gets it just because the requester was on that plan.
 */

export const FEATURE_STATUS_LABELS: Record<FeatureRequestStatus, string> = {
  SUBMITTED: "Submitted",
  NEEDS_INFO: "Needs clarification",
  UNDER_EVALUATION: "Under evaluation",
  APPROVED: "Approved",
  IN_DEVELOPMENT: "In development",
  TESTING: "Testing",
  RELEASED: "Released",
  DECLINED: "Declined",
};

/** Where each status may go next. Decided requests can be reopened only to evaluation. */
const NEXT: Record<FeatureRequestStatus, FeatureRequestStatus[]> = {
  SUBMITTED: ["UNDER_EVALUATION", "NEEDS_INFO", "DECLINED"],
  NEEDS_INFO: ["UNDER_EVALUATION", "DECLINED"],
  UNDER_EVALUATION: ["NEEDS_INFO", "APPROVED", "DECLINED"],
  APPROVED: ["IN_DEVELOPMENT", "DECLINED"],
  IN_DEVELOPMENT: ["TESTING", "APPROVED"],
  TESTING: ["RELEASED", "IN_DEVELOPMENT"],
  RELEASED: [],
  DECLINED: ["UNDER_EVALUATION"],
};

export function nextStatuses(status: FeatureRequestStatus): FeatureRequestStatus[] {
  return NEXT[status];
}

const MODULE_KEYS = new Set<string>([...CORE_MODULES.map((module) => module.key), ...OPTIONAL_MODULES.map((module) => module.key)]);

/** The owner's organization — only the owner of an organization asks and sees its requests. */
async function ownerOrganization(ctx: TenantContext): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const organizationId = await ensureOrganization(ctx.user.homeSchoolId ?? ctx.schoolId);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ownerId: true } });
  if (organization.ownerId !== ctx.user.id) throw new AppError("FORBIDDEN", "Only the school owner can request and follow custom features.");
  return organizationId;
}

export type FeatureRequestInput = {
  title: string;
  problem: string;
  description: string;
  expectedOutcome: string | null;
  schoolId: string | null;
  moduleKey: string | null;
  priority: FeatureRequestPriority;
  examples: string | null;
};

export async function submitFeatureRequest(ctx: TenantContext, input: FeatureRequestInput) {
  const organizationId = await ownerOrganization(ctx);
  assertNotDemo(ctx.user, "Custom feature requests");
  await assertPlanFeature(organizationId, "FEATURE_REQUESTS");
  // The campus must be one of this organization's; a foreign id is refused, not ignored.
  if (input.schoolId && !(await prisma.school.count({ where: { id: input.schoolId, organizationId } }))) throw new NotFoundError("That campus is not one of yours.");
  const moduleKey = input.moduleKey && MODULE_KEYS.has(input.moduleKey) ? input.moduleKey : null;
  const row = await prisma.featureRequest.create({
    data: { organizationId, schoolId: input.schoolId, requestedById: ctx.user.id, title: input.title, problem: input.problem, description: input.description, expectedOutcome: input.expectedOutcome, moduleKey, priority: input.priority, examples: input.examples, events: { create: { actorId: ctx.user.id, toStatus: "SUBMITTED", body: "Request submitted." } } },
    select: { id: true },
  });
  await recordAudit({ action: "FEATURE_REQUEST_CREATED", entityType: "FeatureRequest", entityId: row.id, schoolId: ctx.user.homeSchoolId ?? ctx.schoolId, actorId: ctx.user.id, summary: `Custom feature requested: "${input.title}" (${input.priority.toLowerCase()} priority).` });
  return row;
}

/** The owner's requests, newest first. */
export async function myFeatureRequests(ctx: TenantContext) {
  const organizationId = await ownerOrganization(ctx);
  return prisma.featureRequest.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, priority: true, createdAt: true, updatedAt: true, estimatedTimeline: true, estimatedCostMinor: true, school: { select: { name: true } } } });
}

/** One request with its history — internal notes left out. */
export async function myFeatureRequest(ctx: TenantContext, requestId: string) {
  const organizationId = await ownerOrganization(ctx);
  const row = await prisma.featureRequest.findFirst({
    where: { id: requestId, organizationId },
    include: { school: { select: { name: true } }, events: { where: { internal: false }, orderBy: { createdAt: "asc" }, include: { actor: { select: { firstName: true, lastName: true, role: true } } } } },
  });
  if (!row) throw new NotFoundError();
  // Internal fields stay with SchoolOS.
  const { eligibleOrgIds: _orgs, eligiblePlanIds: _plans, developedBy: _dev, testedBy: _test, potentialStandard: _std, ...visible } = row;
  void _orgs;
  void _plans;
  void _dev;
  void _test;
  void _std;
  return visible;
}

/** The owner answers a clarification (or adds detail). Answering a NEEDS_INFO request sends it back for evaluation. */
export async function commentOnMyFeatureRequest(ctx: TenantContext, requestId: string, body: string) {
  const organizationId = await ownerOrganization(ctx);
  assertNotDemo(ctx.user, "Custom feature requests");
  const row = await prisma.featureRequest.findFirst({ where: { id: requestId, organizationId }, select: { id: true, status: true, title: true } });
  if (!row) throw new NotFoundError();
  if (row.status === "RELEASED" || row.status === "DECLINED") throw new ConflictError("This request is closed. Send a new request instead.");
  const reopen = row.status === "NEEDS_INFO";
  await prisma.$transaction([
    prisma.featureRequestEvent.create({ data: { requestId: row.id, actorId: ctx.user.id, body, ...(reopen ? { fromStatus: "NEEDS_INFO", toStatus: "UNDER_EVALUATION" } : {}) } }),
    ...(reopen ? [prisma.featureRequest.update({ where: { id: row.id }, data: { status: "UNDER_EVALUATION" } })] : []),
  ]);
  await recordAudit({ action: "FEATURE_REQUEST_COMMENTED", entityType: "FeatureRequest", entityId: row.id, schoolId: ctx.user.homeSchoolId ?? ctx.schoolId, actorId: ctx.user.id, summary: `Owner replied on "${row.title}".` });
}

// --- Super Admin ------------------------------------------------------------

export async function listFeatureRequests(actor: SessionUser, status?: FeatureRequestStatus | null) {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.featureRequest.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, title: true, status: true, priority: true, createdAt: true, releaseScope: true, organization: { select: { name: true } }, school: { select: { name: true } } },
  });
}

export async function getFeatureRequest(actor: SessionUser, requestId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.featureRequest.findUnique({
    where: { id: requestId },
    include: { organization: { select: { id: true, name: true } }, school: { select: { name: true } }, requestedBy: { select: { firstName: true, lastName: true, email: true } }, events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { firstName: true, lastName: true, role: true } } } } },
  });
  if (!row) throw new NotFoundError();
  return row;
}

export type FeatureDecision = {
  status: FeatureRequestStatus;
  note: string | null;
  internal: boolean;
  estimatedTimeline: string | null;
  estimatedCostMinor: number | null;
  costAgreed: boolean;
  potentialStandard: boolean;
  releaseScope: FeatureReleaseScope | null;
  eligiblePlanIds: string[];
  eligibleOrgIds: string[];
  releaseNote: string | null;
  developedBy: string | null;
  testedBy: string | null;
};

/**
 * Move a request along (or just update its details). Rules: clarification
 * needs a question; development needs an agreed cost and timeline; release
 * needs a scope, and a scope that reaches beyond the requester needs the
 * plans or organizations it reaches.
 */
export async function decideFeatureRequest(actor: SessionUser, requestId: string, decision: FeatureDecision) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.featureRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true, title: true, organizationId: true, schoolId: true } });
  if (!row) throw new NotFoundError();
  const moving = decision.status !== row.status;
  if (moving && !NEXT[row.status].includes(decision.status)) throw new ConflictError(`A request that is ${FEATURE_STATUS_LABELS[row.status].toLowerCase()} cannot move to ${FEATURE_STATUS_LABELS[decision.status].toLowerCase()}.`);
  if (moving && decision.status === "NEEDS_INFO" && !decision.note?.trim()) throw new AppError("VALIDATION", "Write the question for the school.");
  if (moving && decision.status === "DECLINED" && !decision.note?.trim()) throw new AppError("VALIDATION", "Give the school a reason.");
  if (moving && decision.status === "IN_DEVELOPMENT" && (!decision.costAgreed || !decision.estimatedTimeline)) throw new AppError("VALIDATION", "Agree the cost and the timeline with the school before development starts.");
  if (decision.status === "RELEASED") {
    if (!decision.releaseScope) throw new AppError("VALIDATION", "Decide what the released feature is: customer-specific, optional module, standard feature or paid add-on.");
    if (decision.releaseScope === "STANDARD_FEATURE" && !decision.eligiblePlanIds.length) throw new AppError("VALIDATION", "Choose the plans that get it as a standard feature (then add it in the Plan Builder).");
    if (decision.releaseScope === "OPTIONAL_MODULE" && !decision.eligibleOrgIds.length && !decision.eligiblePlanIds.length) throw new AppError("VALIDATION", "Choose who may switch the optional module on.");
  }
  // Only real plans; only real organizations.
  const plans = decision.eligiblePlanIds.length ? (await prisma.plan.findMany({ where: { id: { in: decision.eligiblePlanIds } }, select: { id: true } })).map((plan) => plan.id) : [];
  const orgs = decision.eligibleOrgIds.length ? (await prisma.organization.findMany({ where: { id: { in: decision.eligibleOrgIds } }, select: { id: true } })).map((org) => org.id) : [];
  const eligibleOrgIds = decision.releaseScope === "CUSTOMER_SPECIFIC" ? [row.organizationId] : orgs;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.featureRequest.updateMany({
      where: { id: row.id, status: row.status },
      data: {
        status: decision.status,
        estimatedTimeline: decision.estimatedTimeline,
        estimatedCostMinor: decision.estimatedCostMinor,
        costAgreed: decision.costAgreed,
        potentialStandard: decision.potentialStandard,
        releaseScope: decision.releaseScope,
        eligiblePlanIds: plans,
        eligibleOrgIds,
        releaseNote: decision.releaseNote,
        developedBy: decision.developedBy,
        testedBy: decision.testedBy,
        ...(moving && decision.status === "APPROVED" ? { approvedById: actor.id, approvedAt: new Date() } : {}),
        ...(moving && decision.status === "RELEASED" ? { releasedById: actor.id, releasedAt: new Date() } : {}),
      },
    });
    if (!count) throw new ConflictError("The request changed meanwhile. Reload and try again.");
    if (moving || decision.note?.trim()) {
      await tx.featureRequestEvent.create({ data: { requestId: row.id, actorId: actor.id, body: decision.note?.trim() || null, internal: !moving && decision.internal, ...(moving ? { fromStatus: row.status, toStatus: decision.status } : {}) } });
    }
  });
  await recordAudit({
    action: moving ? "FEATURE_REQUEST_STATUS_CHANGED" : "FEATURE_REQUEST_UPDATED",
    entityType: "FeatureRequest",
    entityId: row.id,
    schoolId: row.schoolId,
    actorId: actor.id,
    summary: `"${row.title}": ${moving ? `${FEATURE_STATUS_LABELS[row.status]} → ${FEATURE_STATUS_LABELS[decision.status]}` : "details updated"}.${decision.estimatedCostMinor !== null ? ` Estimate ${formatMoney(decision.estimatedCostMinor)}${decision.costAgreed ? " (agreed)" : ""}.` : ""}${decision.releaseScope ? ` Scope: ${decision.releaseScope.toLowerCase().replaceAll("_", " ")}.` : ""}`,
    metadata: { from: row.status, to: decision.status, releaseScope: decision.releaseScope, eligiblePlanIds: plans, eligibleOrgIds },
  });
}
