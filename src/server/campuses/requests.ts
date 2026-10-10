import "server-only";

import { assertNotDemo } from "@/server/demo/guard";

import type { Prisma } from "@/generated/prisma/client";
import type { CampusRequestStatus } from "@/generated/prisma/enums";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { cleanModules, moduleLabel } from "@/lib/school-modules";
import { type Limits, cleanLimits, cleanRoles, describeLimits, limitLabel, roleLabel } from "@/lib/school-roles";
import type { CampusRequestInput } from "@/lib/validation/campuses";
import { provisionSchool } from "@/server/academics/provision";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { campusCount, campusLimitOf, ensureOrganization } from "@/server/platform/campuses";
import { currentPlanOf, planLimits } from "@/server/platform/entitlements";
import { uniqueSlug } from "@/server/platform/registration";
import { formatMoney } from "@/lib/format";
import { periodLabel } from "@/lib/plan-catalog";

/**
 * New campus requests: a School Admin (normally the Owner) asks; only the
 * Super Admin approves — as asked, modified, or not at all. Nothing is
 * created until approval, and what was asked is kept beside what was approved.
 *
 * Everything requested is checked against the organization's plan (the plan
 * of its first campus): campus limit, modules, roles and limits. A request
 * can never ask for more than the plan includes.
 */

const OPEN: CampusRequestStatus[] = ["PENDING", "UNDER_REVIEW"];

/** The organization's plan, as the request form and its checks see it. */
async function organizationPlan(organizationId: string) {
  const primary = await prisma.school.findFirst({ where: { organizationId, status: { in: ["ACTIVE", "SUSPENDED"] } }, orderBy: { createdAt: "asc" }, select: { id: true, optionalModules: true, enabledRoles: true } });
  const plan = primary ? await currentPlanOf(primary.id) : null;
  // No live plan (billing is out of V1): a new campus may have what the first one has.
  return {
    planId: plan?.id ?? null,
    planName: plan?.name ?? null,
    modules: cleanModules(plan?.optionalModules ?? primary?.optionalModules ?? []),
    roles: cleanRoles(plan?.availableRoles ?? primary?.enabledRoles ?? []),
    limits: plan ? planLimits(plan) : ({} as Limits),
  };
}

/**
 * Whether another campus can be asked for, what it would cost, and why not.
 * Past the included campuses an extra campus is quoted at the plan's price
 * (a quote — SchoolOS bills it manually after approval); past the cap, it
 * needs an upgrade or the Super Admin's say-so.
 */
async function capacity(organizationId: string) {
  const [policy, count, pending] = await Promise.all([
    campusLimitOf(organizationId),
    campusCount(organizationId),
    prisma.campusRequest.count({ where: { organizationId, status: { in: OPEN } } }),
  ]);
  const { limit, included, planName } = policy;
  const plan = planName ? `Your current plan (${planName})` : "Your current plan";
  const next = count + pending + 1;
  const beyondCap = limit !== null && next > limit;
  const extra = !beyondCap && next > included && policy.extraAllowed;
  const extraFee = extra ? { amountMinor: policy.extraPriceMinor ?? 0, period: policy.extraPeriod } : null;
  // Asking is always allowed. This only explains what approval would need.
  let entitlement: string | null = null;
  if (beyondCap || (next > included && !policy.extraAllowed)) {
    const allowance = policy.overridden && limit !== null ? `${plan}: SchoolOS has set your organization to up to ${limit === 1 ? "1 campus" : `${limit} campuses`}` : `${plan} includes ${included === 1 ? "1 campus" : `${included} campuses`}${limit !== null && limit !== included ? ` (up to ${limit} in all)` : ""}`;
    entitlement = `${allowance}, and you have ${count}${pending ? ` plus ${pending} waiting for review` : ""}. You can still send a request — opening another campus needs a plan upgrade or extra campus entitlement, which SchoolOS confirms when reviewing it.`;
  }
  return { limit, included, count, pending, entitlement, extraFee, withinEntitlement: entitlement === null };
}

/** What the "Request new school/campus" page needs for this School Admin. */
export async function campusRequestOverview(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const organizationId = await ensureOrganization(ctx.user.homeSchoolId ?? ctx.schoolId);
  const [cap, plan, requests] = await Promise.all([
    capacity(organizationId),
    organizationPlan(organizationId),
    prisma.campusRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, city: true, status: true, createdAt: true, rejectionReason: true, reviewNote: true, approvedModules: true, approvedRoles: true, approvedLimits: true, requestedModules: true, requestedRoles: true, requestedLimits: true, createdSchoolId: true },
    }),
  ]);
  // Every School Admin may ask, on every plan; approval decides the rest.
  return { organizationId, ...cap, plan, requests, canRequest: true };
}

/** Everything a request asks for, checked against the plan. Shared by submit and edit. */
async function checkedRequest(organizationId: string, input: CampusRequestInput, limitsAsked: Limits, excludeRequestId: string | null) {
  const plan = await organizationPlan(organizationId);
  const modules = cleanModules(input.modules);
  const roles = cleanRoles(input.roles);
  const limits = cleanLimits(limitsAsked);
  // Anything beyond the plan may be asked for; it is noted for the Super
  // Admin, who decides — nothing is granted by asking.
  const entitlementNotes: string[] = [];
  const outsideModules = modules.filter((key) => !plan.modules.includes(key));
  if (outsideModules.length) entitlementNotes.push(`Modules not in the current plan: ${outsideModules.map(moduleLabel).join(", ")}.`);
  const outsideRoles = roles.filter((key) => !plan.roles.includes(key));
  if (outsideRoles.length) entitlementNotes.push(`Roles not in the current plan: ${outsideRoles.map(roleLabel).join(", ")}.`);
  for (const [key, value] of Object.entries(limits) as Array<[keyof Limits, number]>) {
    const max = plan.limits[key];
    if (max !== undefined && value > max) entitlementNotes.push(`${limitLabel(key)}: asks for ${value}, the plan allows ${max}.`);
  }
  // One school, one open request — and never a second campus with the same name.
  const name = input.name.trim();
  const [openDuplicate, existingCampus] = await Promise.all([
    prisma.campusRequest.findFirst({ where: { organizationId, status: { in: OPEN }, name: { equals: name, mode: "insensitive" }, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) }, select: { id: true } }),
    prisma.school.findFirst({ where: { organizationId, status: { in: ["PENDING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED"] }, name: { equals: name, mode: "insensitive" } }, select: { id: true } }),
  ]);
  if (openDuplicate) throw new AppError("CONFLICT", `There is already an open request for ${name}. Open it from My Campus Requests instead of sending another.`);
  if (existingCampus) throw new AppError("CONFLICT", `${name} is already one of your schools.`);
  return {
    modules,
    roles,
    limits,
    data: {
      name,
      addressLine: input.addressLine,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      contactName: input.contactName,
      contactEmail: input.contactEmail.toLowerCase(),
      contactPhone: input.contactPhone,
      affiliationBoard: input.affiliationBoard,
      expectedStudents: input.expectedStudents,
      expectedTeachers: input.expectedTeachers,
      expectedStaff: input.expectedStaff,
      notes: input.notes,
      requestedModules: modules,
      requestedRoles: roles,
      requestedLimits: limits,
      entitlementNotes,
    },
  };
}

export async function submitCampusRequest(ctx: TenantContext, input: CampusRequestInput, limitsAsked: Limits) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  assertNotDemo(ctx.user, "Campus requests");
  const organizationId = await ensureOrganization(ctx.user.homeSchoolId ?? ctx.schoolId);
  const cap = await capacity(organizationId);
  const { modules, roles, limits, data } = await checkedRequest(organizationId, input, limitsAsked, null);
  if (cap.entitlement) data.entitlementNotes.unshift(`Campus limit: the plan includes ${cap.included}${cap.limit !== null && cap.limit !== cap.included ? ` (cap ${cap.limit})` : ""}; this would be campus ${cap.count + cap.pending + 1}.`);
  if (cap.extraFee) data.entitlementNotes.unshift(`Extra campus beyond the ${cap.included} included: quoted ${formatMoney(cap.extraFee.amountMinor)} per ${periodLabel(cap.extraFee.period)}.`);

  const row = await prisma.campusRequest.create({
    data: { ...data, quotedExtraFeeMinor: cap.extraFee?.amountMinor ?? null, quotedExtraPeriod: cap.extraFee?.period ?? null, organizationId, fromSchoolId: ctx.user.homeSchoolId ?? ctx.schoolId, requestedById: ctx.user.id },
    select: { id: true },
  });
  await recordAudit({
    action: "CAMPUS_REQUEST_CREATED",
    entityType: "CampusRequest",
    entityId: row.id,
    schoolId: ctx.user.homeSchoolId ?? ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Requested a new campus "${input.name}" (${input.city}). Modules: ${modules.map(moduleLabel).join(", ") || "core only"}. Roles: ${roles.map(roleLabel).join(", ") || "core only"}. Limits: ${describeLimits(limits)}.`,
    metadata: { organizationId, modules, roles, limits },
  });
  return row;
}

/**
 * Correct a request while it is still PENDING. Once the Super Admin has taken
 * it up (or decided), it is frozen: a change after approval is a new request.
 */
export async function updateCampusRequest(ctx: TenantContext, requestId: string, input: CampusRequestInput, limitsAsked: Limits) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  assertNotDemo(ctx.user, "Campus requests");
  const organizationId = await ensureOrganization(ctx.user.homeSchoolId ?? ctx.schoolId);
  const row = await prisma.campusRequest.findFirst({ where: { id: requestId, organizationId }, select: { id: true, status: true } });
  if (!row) throw new NotFoundError();
  if (row.status !== "PENDING") throw new ConflictError("This request is already with SchoolOS (or decided) and can no longer be changed. Send a new request for any change.");
  const { modules, roles, limits, data } = await checkedRequest(organizationId, input, limitsAsked, row.id);
  // Only a still-pending row is written, so a review that starts meanwhile wins.
  const { count } = await prisma.campusRequest.updateMany({ where: { id: row.id, status: "PENDING" }, data });
  if (!count) throw new ConflictError("This request was taken up for review meanwhile and can no longer be changed.");
  await recordAudit({
    action: "CAMPUS_REQUEST_UPDATED",
    entityType: "CampusRequest",
    entityId: row.id,
    schoolId: ctx.user.homeSchoolId ?? ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Changed the campus request "${data.name}". Modules: ${modules.map(moduleLabel).join(", ") || "core only"}. Roles: ${roles.map(roleLabel).join(", ") || "core only"}. Limits: ${describeLimits(limits)}.`,
    metadata: { modules, roles, limits },
  });
}

/** The decision history of one request, oldest first — from the audit log. */
async function requestHistory(requestId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "CampusRequest", entityId: requestId },
    orderBy: { createdAt: "asc" },
    select: { id: true, action: true, summary: true, createdAt: true, actor: { select: { firstName: true, lastName: true, role: true } } },
  });
  return rows.map((row) => ({ id: row.id, action: row.action, summary: row.summary, at: row.createdAt, by: row.actor ? (row.actor.role === "SUPER_ADMIN" ? "SchoolOS" : `${row.actor.firstName} ${row.actor.lastName}`) : null }));
}

/** One of this organization's requests, with the decision and its history. Another organization's request is "not found". */
export async function getMyCampusRequest(ctx: TenantContext, requestId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const organizationId = await ensureOrganization(ctx.user.homeSchoolId ?? ctx.schoolId);
  const row = await prisma.campusRequest.findFirst({
    where: { id: requestId, organizationId },
    include: { requestedBy: { select: { firstName: true, lastName: true } }, createdSchool: { select: { id: true, name: true, status: true } } },
  });
  if (!row) throw new NotFoundError();
  const [history, plan] = await Promise.all([requestHistory(row.id), organizationPlan(organizationId)]);
  return { ...row, history, plan, editable: row.status === "PENDING" };
}

// --- Super Admin ------------------------------------------------------------

const LIST_SELECT = {
  id: true,
  name: true,
  city: true,
  state: true,
  status: true,
  createdAt: true,
  requestedModules: true,
  requestedRoles: true,
  requestedLimits: true,
  approvedModules: true,
  approvedRoles: true,
  approvedLimits: true,
  entitlementNotes: true,
  organization: { select: { id: true, name: true, owner: { select: { firstName: true, lastName: true, email: true } } } },
} as const;

export async function listCampusRequests(actor: SessionUser, status?: CampusRequestStatus | null) {
  assertRole(actor, "SUPER_ADMIN");
  const rows = await prisma.campusRequest.findMany({ where: status ? { status } : {}, orderBy: [{ createdAt: "desc" }], take: 200, select: LIST_SELECT });
  const counts = await prisma.school.groupBy({ by: ["organizationId"], where: { organizationId: { in: [...new Set(rows.map((row) => row.organization.id))] }, status: { in: ["PENDING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED"] } }, _count: { _all: true } });
  const countOf = new Map(counts.map((row) => [row.organizationId, row._count._all]));
  return rows.map((row) => ({ ...row, campuses: countOf.get(row.organization.id) ?? 0 }));
}

export async function countOpenCampusRequests(actor: SessionUser): Promise<number> {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.campusRequest.count({ where: { status: { in: OPEN } } });
}

export async function getCampusRequest(actor: SessionUser, requestId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.campusRequest.findUnique({
    where: { id: requestId },
    include: {
      organization: { select: { id: true, name: true, campusLimitOverride: true, owner: { select: { firstName: true, lastName: true, email: true } }, schools: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, status: true } } } },
      requestedBy: { select: { firstName: true, lastName: true, email: true } },
      reviewedBy: { select: { firstName: true, lastName: true } },
      createdSchool: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!row) throw new NotFoundError();
  const [plan, cap, history] = await Promise.all([organizationPlan(row.organizationId), campusLimitOf(row.organizationId), requestHistory(row.id)]);
  return { ...row, plan, history, campusLimit: cap.limit, campusIncluded: cap.included, campusCount: await campusCount(row.organizationId) };
}

async function openRequest(requestId: string) {
  const row = await prisma.campusRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new NotFoundError();
  if (!OPEN.includes(row.status)) throw new ConflictError(`This request is already ${row.status.toLowerCase().replace("_", " ")}.`);
  return row;
}

export async function markCampusRequestUnderReview(actor: SessionUser, requestId: string): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");
  const row = await openRequest(requestId);
  if (row.status === "UNDER_REVIEW") return;
  await prisma.campusRequest.update({ where: { id: row.id }, data: { status: "UNDER_REVIEW", reviewedById: actor.id, reviewedAt: new Date() } });
  await recordAudit({ action: "CAMPUS_REQUEST_UNDER_REVIEW", entityType: "CampusRequest", entityId: row.id, schoolId: row.fromSchoolId, actorId: actor.id, summary: `Campus request "${row.name}" taken up for review.` });
}

export async function rejectCampusRequest(actor: SessionUser, requestId: string, reason: string): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");
  if (!reason.trim()) throw new ConflictError("Give a reason — the school is told why.");
  const row = await openRequest(requestId);
  await prisma.campusRequest.update({ where: { id: row.id }, data: { status: "REJECTED", rejectionReason: reason, reviewedById: actor.id, reviewedAt: new Date() } });
  await recordAudit({ action: "CAMPUS_REQUEST_REJECTED", entityType: "CampusRequest", entityId: row.id, schoolId: row.fromSchoolId, actorId: actor.id, summary: `Campus request "${row.name}" rejected: ${reason}`, metadata: { reason } });
}

/**
 * Approve — as asked, or modified — and only then create the campus: a new
 * school in the same organization, live, on the organization's plan, with the
 * approved modules, roles and limits, and the default academic setup every new
 * school gets. No students, staff or classes beyond that default setup.
 */
export async function approveCampusRequest(
  actor: SessionUser,
  requestId: string,
  decision: { modules: readonly string[]; roles: readonly string[]; limits: Limits; reviewNote: string | null; raiseLimit?: boolean },
): Promise<{ schoolId: string; status: CampusRequestStatus }> {
  assertRole(actor, "SUPER_ADMIN");
  const row = await openRequest(requestId);
  const { limit } = await campusLimitOf(row.organizationId);
  const count = await campusCount(row.organizationId);
  // At the limit, approving needs the Super Admin's explicit say-so to raise
  // it (to exactly one more campus) — never a silent overrun of the plan.
  const raiseTo = limit !== null && count >= limit ? count + 1 : null;
  if (raiseTo !== null && !decision.raiseLimit) throw new AppError("CONFLICT", `This organization is at its campus limit (${limit}). Tick “Raise the campus limit to ${raiseTo}” to approve, or raise the limit first.`);

  const plan = await organizationPlan(row.organizationId);
  // The Super Admin may grant anything that exists; unknown keys are dropped.
  const modules = cleanModules(decision.modules);
  const roles = cleanRoles(decision.roles);
  const limits = cleanLimits(decision.limits);
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key) => b.includes(key));
  const asked = cleanLimits(row.requestedLimits);
  const modified = !same(modules, cleanModules(row.requestedModules)) || !same(roles, cleanRoles(row.requestedRoles)) || JSON.stringify(Object.entries(limits).sort()) !== JSON.stringify(Object.entries(asked).sort());
  const status: CampusRequestStatus = modified ? "MODIFIED" : "APPROVED";
  const slug = await uniqueSlug(row.name);

  const schoolId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const school = await tx.school.create({
      data: {
        slug,
        status: "ACTIVE",
        name: row.name,
        addressLine: row.addressLine,
        city: row.city,
        state: row.state,
        postalCode: row.postalCode,
        affiliationBoard: row.affiliationBoard,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
        contactEmailVerifiedAt: new Date(),
        reviewedAt: new Date(),
        reviewedById: actor.id,
        organizationId: row.organizationId,
        optionalModules: modules,
        modulesCustomized: !same(modules, plan.modules),
        enabledRoles: roles,
        rolesCustomized: !same(roles, plan.roles),
        roleLimits: Object.keys(limits).length ? limits : undefined,
        ...(plan.planId ? { subscriptions: { create: { planId: plan.planId, status: "ACTIVE", startsAt: new Date(), notes: "Campus approved from a campus request." } } } : {}),
      },
      select: { id: true },
    });
    await provisionSchool(tx, school.id);
    if (raiseTo !== null) await tx.organization.update({ where: { id: row.organizationId }, data: { campusLimitOverride: raiseTo } });
    // Provisioned once: only a still-open request is closed; a second
    // approval racing this one finds it closed and rolls its school back.
    const { count: closed } = await tx.campusRequest.updateMany({
      where: { id: row.id, status: { in: OPEN }, createdSchoolId: null },
      data: { status, approvedModules: modules, approvedRoles: roles, approvedLimits: limits, reviewNote: decision.reviewNote, reviewedById: actor.id, reviewedAt: new Date(), createdSchoolId: school.id },
    });
    if (!closed) throw new ConflictError("This request was decided meanwhile. Nothing was created.");
    // An organization without an owner gets the person who asked.
    if (row.requestedById) await tx.organization.updateMany({ where: { id: row.organizationId, ownerId: null }, data: { ownerId: row.requestedById } });
    return school.id;
  });

  await recordAudit({
    action: modified ? "CAMPUS_REQUEST_MODIFIED" : "CAMPUS_REQUEST_APPROVED",
    entityType: "CampusRequest",
    entityId: row.id,
    schoolId: row.fromSchoolId,
    actorId: actor.id,
    summary: `Campus request "${row.name}" ${modified ? "approved with changes" : "approved"}. Modules: ${modules.map(moduleLabel).join(", ") || "core only"}. Roles: ${roles.map(roleLabel).join(", ") || "core only"}. Limits: ${describeLimits(limits)}.`,
    metadata: { requested: { modules: row.requestedModules, roles: row.requestedRoles, limits: asked }, approved: { modules, roles, limits }, schoolId },
  });
  if (raiseTo !== null) await recordAudit({ action: "ORGANIZATION_CAMPUS_LIMIT_CHANGED", entityType: "Organization", entityId: row.organizationId, schoolId: row.fromSchoolId, actorId: actor.id, summary: `Campus limit raised from ${limit} to ${raiseTo} to approve "${row.name}".`, metadata: { previous: limit, next: raiseTo, requestId: row.id } });
  await recordAudit({ action: "CAMPUS_ACTIVATED", entityType: "School", entityId: schoolId, schoolId, actorId: actor.id, summary: `${row.name} is live as a campus of the organization.`, metadata: { organizationId: row.organizationId, requestId: row.id } });
  return { schoolId, status };
}

/** Refuse a School Admin acting for an organization that is not theirs (used by tests and pages). */
export async function assertOwnsRequest(ctx: TenantContext, requestId: string): Promise<void> {
  const organizationId = await ensureOrganization(ctx.user.homeSchoolId ?? ctx.schoolId);
  const row = await prisma.campusRequest.findUnique({ where: { id: requestId }, select: { organizationId: true } });
  if (!row || row.organizationId !== organizationId) throw new ForbiddenError();
}
