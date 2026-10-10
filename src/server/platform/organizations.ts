import "server-only";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { campusAllowanceText, campusPolicy, cleanFeatures, featureLabel, quote } from "@/lib/plan-catalog";
import { cleanModules, moduleLabel } from "@/lib/school-modules";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { setSubscription } from "@/server/platform/schools";

/**
 * The Super Admin's view of one customer: an organization (the owner's
 * account) and its campuses. The plan is the organization's — every campus
 * carries a subscription row on it, kept in step by `setSubscription` — and
 * each campus has its own switched-on modules. This module reads that
 * picture and changes the plan through the one existing path; it stores
 * nothing of its own.
 */

const LIVE_CAMPUS = ["PENDING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED"] as const;
const LIVE_SUBSCRIPTION = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

const PLAN_FIELDS = { id: true, name: true, slug: true, status: true, isActive: true, priceMinor: true, priceOnRequest: true, billingPeriod: true, currency: true, campusLimit: true, extraCampusAllowed: true, extraCampusPriceMinor: true, extraCampusPeriod: true, maxCampuses: true, optionalModules: true, features: true, maxStudents: true, maxTeachers: true, displayOrder: true } as const;

/** Every customer organization (demo sandboxes left out), with its plan and whether its campuses agree. */
export async function listOrganizations(actor: SessionUser, search: string | null = null) {
  assertRole(actor, "SUPER_ADMIN");
  const q = search?.trim();
  const rows = await prisma.organization.findMany({
    where: {
      schools: { some: { isDemo: false } },
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { schools: { some: { name: { contains: q, mode: "insensitive" } } } }, { owner: { email: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 300,
    select: {
      id: true,
      name: true,
      owner: { select: { firstName: true, lastName: true, email: true } },
      schools: {
        where: { isDemo: false, status: { in: [...LIVE_CAMPUS] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, subscriptions: { where: { status: { in: [...LIVE_SUBSCRIPTION] } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, plan: { select: { id: true, name: true } } } } },
      },
    },
  });
  return rows.map((row) => {
    const plans = row.schools.map((school) => school.subscriptions[0]?.plan ?? null);
    const primary = plans[0] ?? null;
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      campuses: row.schools.length,
      plan: primary,
      status: row.schools[0]?.subscriptions[0]?.status ?? null,
      mixedPlans: new Set(plans.map((plan) => plan?.id ?? "none")).size > 1,
    };
  });
}

/** One organization in full: plan, allowance, campuses (each with its plan and modules), and history. */
export async function organizationDetail(actor: SessionUser, organizationId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, schools: { some: { isDemo: false } } },
    select: {
      id: true,
      name: true,
      campusLimitOverride: true,
      createdAt: true,
      owner: { select: { firstName: true, lastName: true, email: true } },
      schools: {
        where: { isDemo: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
          status: true,
          optionalModules: true,
          modulesCustomized: true,
          subscriptions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, startsAt: true, endsAt: true, notes: true, plan: { select: PLAN_FIELDS } } },
          _count: { select: { students: { where: { status: "ACTIVE" } }, teachers: { where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } } } },
        },
      },
    },
  });
  if (!organization) throw new NotFoundError();

  const live = organization.schools.filter((school) => (LIVE_CAMPUS as readonly string[]).includes(school.status));
  const primary = live[0] ?? organization.schools[0];
  const subscription = primary?.subscriptions[0] ?? null;
  const plan = subscription?.plan ?? null;
  const eligible = cleanModules(plan?.optionalModules ?? []);
  const policy = campusPolicy(plan ?? { campusLimit: 1, extraCampusAllowed: false, extraCampusPriceMinor: null, extraCampusPeriod: "YEARLY", maxCampuses: null }, organization.campusLimitOverride);

  const campuses = organization.schools.map((school) => {
    const enabled = cleanModules(school.optionalModules);
    const own = school.subscriptions[0] ?? null;
    return {
      id: school.id,
      name: school.name,
      place: [school.city, school.state].filter(Boolean).join(", "),
      status: school.status,
      live: (LIVE_CAMPUS as readonly string[]).includes(school.status),
      plan: own ? { id: own.plan.id, name: own.plan.name, status: own.status } : null,
      /** True when this campus is not on the organization's plan (data from before plans were kept in step). */
      differs: (LIVE_CAMPUS as readonly string[]).includes(school.status) && (own?.plan.id ?? null) !== (plan?.id ?? null),
      enabled,
      available: eligible.filter((key) => !enabled.includes(key)),
      kept: enabled.filter((key) => !eligible.includes(key)),
      students: school._count.students,
      teachers: school._count.teachers,
    };
  });

  const history = await prisma.auditLog.findMany({
    where: {
      OR: [
        { schoolId: { in: organization.schools.map((school) => school.id) }, action: { in: ["SUBSCRIPTION_UPDATED", "SCHOOL_PLAN_CHANGED", "PLAN_CHANGE_REQUESTED", "PLAN_CHANGE_APPROVED", "PLAN_CHANGE_REJECTED", "PLAN_CHANGE_CANCELLED", "CAMPUS_MODULES_CHANGED", "SCHOOL_MODULES_CHANGED", "CAMPUS_ACTIVATED"] } },
        { entityType: "Organization", entityId: organization.id },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, action: true, summary: true, createdAt: true, actor: { select: { firstName: true, lastName: true, role: true } } },
  });

  return {
    organization: { id: organization.id, name: organization.name, owner: organization.owner, createdAt: organization.createdAt, campusLimitOverride: organization.campusLimitOverride },
    plan,
    subscription: subscription ? { status: subscription.status, startsAt: subscription.startsAt, endsAt: subscription.endsAt, notes: subscription.notes } : null,
    primarySchoolId: primary?.id ?? null,
    allowance: { live: live.length, included: policy.included, cap: policy.cap, overridden: policy.overridden, text: plan ? campusAllowanceText(plan) : "No plan" },
    quote: plan ? quote(plan, live.length) : null,
    eligible,
    features: cleanFeatures(plan?.features ?? []),
    campuses,
    mixedPlans: campuses.some((campus) => campus.differs),
    history,
  };
}

/**
 * What moving the organization to `planId` would mean — shown before the
 * Super Admin confirms. Modules never switch on by themselves; modules the
 * new plan leaves out stay on where they are on (kept) until switched off.
 */
export async function planChangePreview(actor: SessionUser, organizationId: string, planId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const [detail, next] = await Promise.all([organizationDetail(actor, organizationId), prisma.plan.findFirst({ where: { id: planId, status: "PUBLISHED" }, select: PLAN_FIELDS })]);
  if (!next) throw new NotFoundError("That plan is not published.");
  return previewFrom(detail, next);
}

type Detail = Awaited<ReturnType<typeof organizationDetail>>;
type PlanRow = NonNullable<Detail["plan"]>;

function previewFrom(detail: Detail, next: PlanRow) {
  const before = detail.eligible;
  const after = cleanModules(next.optionalModules);
  const policy = campusPolicy(next, detail.organization.campusLimitOverride);
  const live = detail.allowance.live;
  const featuresBefore = detail.features;
  const featuresAfter = cleanFeatures(next.features);
  const keptBy = detail.campuses.filter((campus) => campus.live).flatMap((campus) => campus.enabled.filter((key) => !after.includes(key)).map((key) => ({ campus: campus.name, module: moduleLabel(key) })));
  return {
    plan: { id: next.id, name: next.name },
    same: detail.plan?.id === next.id,
    newlyEligible: after.filter((key) => !before.includes(key)).map(moduleLabel),
    noLongerIncluded: before.filter((key) => !after.includes(key)).map(moduleLabel),
    keptOn: keptBy,
    featuresGained: featuresAfter.filter((key) => !featuresBefore.includes(key)).map(featureLabel),
    featuresLost: featuresBefore.filter((key) => !featuresAfter.includes(key)).map(featureLabel),
    quoteBefore: detail.quote,
    quoteAfter: quote(next, live),
    allowanceBefore: detail.allowance.text,
    allowanceAfter: campusAllowanceText(next),
    limits: { studentsBefore: detail.plan?.maxStudents ?? null, studentsAfter: next.maxStudents, teachersBefore: detail.plan?.maxTeachers ?? null, teachersAfter: next.maxTeachers },
    /** More live campuses than the new plan allows (and no override): the existing ones stay, no more can be added. */
    overCap: policy.cap !== null && live > policy.cap ? { live, cap: policy.cap } : null,
    notOffered: !next.isActive,
  };
}

/** Previews for every published plan, so the change form can compare as soon as one is chosen. */
export async function planChangeOptions(actor: SessionUser, organizationId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const [detail, plans] = await Promise.all([
    organizationDetail(actor, organizationId),
    prisma.plan.findMany({ where: { status: "PUBLISHED" }, orderBy: [{ displayOrder: "asc" }, { priceMinor: "asc" }], select: PLAN_FIELDS }),
  ]);
  return plans.map((plan) => previewFrom(detail, plan));
}

/**
 * Change the organization's plan from its page. Goes through
 * `setSubscription` (every campus, one transaction). Refuses a plan that is
 * not published, and asks for explicit confirmation when the organization
 * runs more campuses than the new plan allows. Sending the same plan and
 * status again changes nothing and writes no history — a double submit is
 * harmless.
 */
export async function changeOrganizationPlan(
  actor: SessionUser,
  input: { organizationId: string; planId: string; status: "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELLED" | "EXPIRED"; startsAt: Date; endsAt: Date | null; notes: string | null; confirmOverCap: boolean },
): Promise<{ unchanged: boolean; campuses: number }> {
  assertRole(actor, "SUPER_ADMIN");
  const detail = await organizationDetail(actor, input.organizationId);
  if (!detail.primarySchoolId) throw new NotFoundError("This organization has no campus.");
  const preview = await planChangePreview(actor, input.organizationId, input.planId);
  if (preview.overCap && !input.confirmOverCap) {
    throw new ConflictError(`${detail.organization.name} runs ${preview.overCap.live} campuses but ${preview.plan.name} allows ${preview.overCap.cap}. Tick the box to confirm: existing campuses stay, but no more can be added (or raise its campus limit first).`);
  }
  const allOnIt = detail.campuses.filter((campus) => campus.live).every((campus) => campus.plan?.id === input.planId && campus.plan.status === input.status);
  if (allOnIt && detail.subscription?.endsAt?.getTime() === input.endsAt?.getTime() && (detail.subscription?.notes ?? null) === input.notes) return { unchanged: true, campuses: detail.allowance.live };
  const { campuses } = await setSubscription(actor, { schoolId: detail.primarySchoolId, planId: input.planId, status: input.status, startsAt: input.startsAt, endsAt: input.endsAt, notes: input.notes });
  return { unchanged: false, campuses };
}
