import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { ESSENTIAL_MODULES, PLAN_TEMPLATES, type PlanConfig, campusAllowanceText, isPlanTemplateKey, planWarnings, templateDiff, templateSelection, featureLabel, periodLabel, planConfig, planProblems, planSlug } from "@/lib/plan-catalog";
import { cleanModules, moduleLabel } from "@/lib/school-modules";
import { cleanRoles, describeLimits, roleLabel } from "@/lib/school-roles";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

/**
 * The Plan Builder. The Super Admin edits a plan as a *draft* (stored on the
 * plan, read by nothing public), previews it, sees the impact on existing
 * organizations, and publishes it explicitly. Publishing changes the plan
 * only:
 *
 *   * no campus's switched-on modules change — a plan makes modules
 *     eligible; owners and admins switch them on (grandfathered modules a
 *     plan no longer includes stay on until someone switches them off);
 *   * roles the plan adds are offered to campuses that follow the plan's
 *     roles (additive only — nobody loses a role);
 *   * no subscription row is touched. SchoolOS has no payment gateway: a
 *     price change applies to new sign-ups, requests and quotes; existing
 *     billing is agreed and changed by SchoolOS by hand.
 *
 * Plans are a ladder by display order (Starter → Growth → Pro): a plan must
 * keep everything below it, and every plan keeps the essential modules
 * (`planProblems`).
 */

const LIVE = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

const PLAN_COLUMNS = {
  id: true,
  tier: true,
  slug: true,
  templateKey: true,
  name: true,
  description: true,
  highlights: true,
  displayOrder: true,
  priceMinor: true,
  priceOnRequest: true,
  billingPeriod: true,
  currency: true,
  campusLimit: true,
  extraCampusAllowed: true,
  extraCampusPriceMinor: true,
  extraCampusPeriod: true,
  maxCampuses: true,
  optionalModules: true,
  features: true,
  maxStudents: true,
  maxTeachers: true,
  maxAdmins: true,
  storageMb: true,
  availableRoles: true,
  roleLimits: true,
  isActive: true,
  status: true,
  draft: true,
  draftUpdatedAt: true,
  publishedAt: true,
  updatedAt: true,
} as const;

type PlanRow = Prisma.PlanGetPayload<{ select: typeof PLAN_COLUMNS }>;

/** A plan row's live configuration (the published columns). */
function liveConfig(row: PlanRow): PlanConfig {
  return planConfig({ ...row, roleLimits: row.roleLimits as PlanConfig["roleLimits"] } as unknown as PlanConfig);
}

/** The ladder other plans are checked against: published, not archived. */
async function ladder(excludeId: string | null) {
  const rows = await prisma.plan.findMany({ where: { status: "PUBLISHED", ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true, displayOrder: true, optionalModules: true, features: true } });
  return rows;
}

/** Everything the Plan Builder page shows. */
export async function listPlans(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");
  const rows = await prisma.plan.findMany({ orderBy: [{ displayOrder: "asc" }, { priceMinor: "asc" }], select: PLAN_COLUMNS });
  const published = await ladder(null);
  return Promise.all(
    rows.map(async (row) => {
      const live = liveConfig(row);
      const edited = row.draft ? planConfig(live, row.draft) : null;
      const usage = await planUsage(row.id);
      const shown = edited ?? live;
      return {
        ...row,
        live,
        edited,
        problems: planProblems(shown, published, row.id),
        warnings: planWarnings(shown),
        /** Against its template: what "Customized" means for this plan. */
        templateDiff: templateDiff(shown, row.templateKey),
        /** What the unpublished draft changes, compared with the published plan. */
        changes: edited && row.status !== "DRAFT" ? describeChanges(live, edited) : [],
        usage,
      };
    }),
  );
}

/** Organizations and campuses on a plan (live subscriptions; demo sandboxes left out). */
async function planUsage(planId: string) {
  const subscriptions = await prisma.subscription.findMany({
    where: { planId, status: { in: [...LIVE] }, school: { isDemo: false } },
    select: { school: { select: { id: true, name: true, optionalModules: true, modulesCustomized: true, organizationId: true, organization: { select: { id: true, name: true, campusLimitOverride: true } } } } },
  });
  const organizations = new Map<string, { id: string; name: string; campusLimitOverride: number | null; campuses: Array<{ id: string; name: string; modules: string[] }> }>();
  for (const { school } of subscriptions) {
    const key = school.organization?.id ?? `school:${school.id}`;
    const entry = organizations.get(key) ?? { id: school.organization?.id ?? school.id, name: school.organization?.name ?? school.name, campusLimitOverride: school.organization?.campusLimitOverride ?? null, campuses: [] };
    entry.campuses.push({ id: school.id, name: school.name, modules: cleanModules(school.optionalModules) });
    organizations.set(key, entry);
  }
  const list = [...organizations.values()];
  return { organizations: list, organizationCount: list.length, campusCount: subscriptions.length };
}

/**
 * What publishing `next` would mean for the organizations on the plan —
 * shown before the Super Admin confirms. Nothing here changes data.
 */
export async function planImpact(actor: SessionUser, planId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.plan.findUnique({ where: { id: planId }, select: PLAN_COLUMNS });
  if (!row) throw new NotFoundError();
  return impactOf(row, row.draft ? planConfig(liveConfig(row), row.draft) : liveConfig(row));
}

async function impactOf(row: PlanRow, next: PlanConfig) {
  const live = liveConfig(row);
  const usage = await planUsage(row.id);
  const removed = live.optionalModules.filter((key) => !next.optionalModules.includes(key));
  const added = next.optionalModules.filter((key) => !live.optionalModules.includes(key));
  const featuresRemoved = live.features.filter((key) => !next.features.includes(key));
  const featuresAdded = next.features.filter((key) => !live.features.includes(key));
  // Campuses that have a module switched on that the plan would no longer
  // include: they keep it (grandfathered) — listed so nobody is surprised.
  const grandfathered = usage.organizations.flatMap((org) => org.campuses.filter((campus) => campus.modules.some((key) => removed.includes(key as never))).map((campus) => ({ organization: org.name, campus: campus.name, modules: campus.modules.filter((key) => removed.includes(key as never)) })));
  // Organizations over the new included campuses (extra-campus charges would apply to new quotes).
  const overIncluded = usage.organizations.filter((org) => org.campuses.length > next.campusLimit).map((org) => ({ organization: org.name, campuses: org.campuses.length }));
  const overCap = usage.organizations.filter((org) => {
    const cap = org.campusLimitOverride ?? (next.extraCampusAllowed ? next.maxCampuses : next.campusLimit);
    return cap !== null && org.campuses.length > cap;
  }).map((org) => ({ organization: org.name, campuses: org.campuses.length }));
  const priceChanged = live.priceMinor !== next.priceMinor || live.priceOnRequest !== next.priceOnRequest || live.billingPeriod !== next.billingPeriod || live.extraCampusPriceMinor !== next.extraCampusPriceMinor || live.extraCampusAllowed !== next.extraCampusAllowed;
  const notes: string[] = [];
  if (added.length) notes.push(`Newly eligible: ${added.map(moduleLabel).join(", ")}. Campuses do not get them automatically — owners and admins switch them on.`);
  if (removed.length) notes.push(`No longer included: ${removed.map(moduleLabel).join(", ")}. ${grandfathered.length ? `${grandfathered.length} campus${grandfathered.length === 1 ? "" : "es"} that use them keep them until switched off.` : "No campus on this plan uses them."}`);
  if (featuresAdded.length) notes.push(`Feature added: ${featuresAdded.map(featureLabel).join(", ")}.`);
  if (featuresRemoved.length) notes.push(`Feature removed: ${featuresRemoved.map(featureLabel).join(", ")} — organizations on this plan lose it on publish.`);
  if (next.campusLimit !== live.campusLimit) notes.push(`Included campuses: ${live.campusLimit} → ${next.campusLimit}.`);
  if (overCap.length) notes.push(`${overCap.length} organization${overCap.length === 1 ? " runs" : "s run"} more campuses than the new cap. Their campuses stay; they cannot add more until the cap allows.`);
  if (priceChanged) notes.push("Price change: applies to new sign-ups, plan requests and quotes. Existing customers' billing is not changed automatically.");
  return { organizations: usage.organizationCount, campuses: usage.campusCount, added, removed, featuresAdded, featuresRemoved, grandfathered, overIncluded, overCap, priceChanged, notes };
}

/**
 * A new plan, as a draft that nobody sees until it is published. Started
 * from a template (Starter, Growth, Pro) when one is chosen — its modules,
 * features, roles and campuses are pre-selected — otherwise from the highest
 * plan, so it passes the "keeps everything below" rule.
 */
export async function createPlan(actor: SessionUser, input: { name: string; templateKey?: string | null }) {
  assertRole(actor, "SUPER_ADMIN");
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("VALIDATION", "Give the plan a name.");
  if (input.templateKey && !isPlanTemplateKey(input.templateKey)) throw new AppError("VALIDATION", "Choose Starter, Growth, Pro or no template.");
  const template = isPlanTemplateKey(input.templateKey) ? input.templateKey : null;
  const top = await prisma.plan.findFirst({ where: { status: { not: "ARCHIVED" } }, orderBy: { displayOrder: "desc" }, select: { displayOrder: true, optionalModules: true, features: true, availableRoles: true } });
  let slug = planSlug(name);
  for (let n = 2; await prisma.plan.findUnique({ where: { slug }, select: { id: true } }); n += 1) slug = `${planSlug(name)}-${n}`;
  const start = template
    ? { ...templateSelection(template), description: PLAN_TEMPLATES[template].description }
    : { optionalModules: top ? cleanModules(top.optionalModules) : [...ESSENTIAL_MODULES], features: top?.features ?? [], availableRoles: top ? cleanRoles(top.availableRoles) : undefined, campusLimit: 1, description: null };
  const row = await prisma.plan.create({
    data: {
      slug,
      name,
      templateKey: template,
      status: "DRAFT",
      isActive: true,
      priceMinor: 0,
      priceOnRequest: true,
      displayOrder: (top?.displayOrder ?? 0) + 1,
      description: start.description,
      optionalModules: start.optionalModules,
      features: start.features,
      availableRoles: start.availableRoles,
      campusLimit: start.campusLimit,
    },
    select: { id: true, slug: true },
  });
  await recordAudit({ action: "PLAN_CREATED", entityType: "Plan", entityId: row.id, actorId: actor.id, summary: `Plan "${name}" created as a draft (${row.slug})${template ? ` from the ${PLAN_TEMPLATES[template].label} template` : ""}.` });
  return row;
}

/** Save edits as the plan's draft. Live configuration is untouched. Returns what publishing would refuse. */
export async function savePlanDraft(actor: SessionUser, planId: string, input: Record<string, unknown>) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.plan.findUnique({ where: { id: planId }, select: PLAN_COLUMNS });
  if (!row) throw new NotFoundError();
  if (row.status === "ARCHIVED") throw new ConflictError("Restore this plan before editing it.");
  // Which template the plan is compared with: a label for the editor, not an entitlement.
  const templateKey = "templateKey" in input ? (isPlanTemplateKey(input.templateKey) ? input.templateKey : null) : row.templateKey;
  const next = planConfig(liveConfig(row), input);
  await prisma.plan.update({ where: { id: planId }, data: { draft: next as unknown as Prisma.InputJsonValue, draftUpdatedAt: new Date(), draftById: actor.id, templateKey } });
  const diff = templateDiff(next, templateKey);
  await recordAudit({ action: "PLAN_DRAFT_SAVED", entityType: "Plan", entityId: planId, actorId: actor.id, summary: `Draft saved for plan "${next.name}" (not published)${diff ? ` — ${diff.customized ? `customized from ${diff.template}` : `matches the ${diff.template} template`}` : ""}.` });
  return { problems: planProblems(next, await ladder(planId), planId), warnings: planWarnings(next) };
}

export async function discardPlanDraft(actor: SessionUser, planId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const { count } = await prisma.plan.updateMany({ where: { id: planId, NOT: { draft: { equals: Prisma.DbNull } } }, data: { draft: Prisma.DbNull, draftUpdatedAt: null, draftById: null } });
  if (count) await recordAudit({ action: "PLAN_DRAFT_DISCARDED", entityType: "Plan", entityId: planId, actorId: actor.id, summary: "Unpublished plan changes discarded." });
}

/** One line per changed setting, for the audit log. */
function describeChanges(before: PlanConfig, after: PlanConfig): string[] {
  const lines: string[] = [];
  const money = (value: number | null, onRequest = false) => (onRequest ? "price on request" : value === null ? "—" : formatMoney(value));
  if (before.name !== after.name) lines.push(`Name: ${before.name} → ${after.name}`);
  if (before.priceMinor !== after.priceMinor || before.priceOnRequest !== after.priceOnRequest || before.billingPeriod !== after.billingPeriod) lines.push(`Price: ${money(before.priceMinor, before.priceOnRequest)} / ${periodLabel(before.billingPeriod)} → ${money(after.priceMinor, after.priceOnRequest)} / ${periodLabel(after.billingPeriod)}`);
  if (before.campusLimit !== after.campusLimit || before.extraCampusAllowed !== after.extraCampusAllowed || before.maxCampuses !== after.maxCampuses || before.extraCampusPriceMinor !== after.extraCampusPriceMinor) lines.push(`Campuses: ${campusAllowanceText(before)} → ${campusAllowanceText(after)}${after.extraCampusAllowed ? ` (${money(after.extraCampusPriceMinor)} per extra campus per ${periodLabel(after.extraCampusPeriod)})` : ""}`);
  if (before.optionalModules.join() !== after.optionalModules.join()) lines.push(`Modules: ${before.optionalModules.map(moduleLabel).join(", ") || "core only"} → ${after.optionalModules.map(moduleLabel).join(", ") || "core only"}`);
  if (before.features.join() !== after.features.join()) lines.push(`Features: ${before.features.map(featureLabel).join(", ") || "none"} → ${after.features.map(featureLabel).join(", ") || "none"}`);
  if (before.availableRoles.join() !== after.availableRoles.join()) lines.push(`Roles: ${after.availableRoles.map(roleLabel).join(", ") || "core only"}`);
  if (JSON.stringify(before.roleLimits) !== JSON.stringify(after.roleLimits) || before.maxStudents !== after.maxStudents || before.maxTeachers !== after.maxTeachers) lines.push(`Limits: ${describeLimits(after.roleLimits)}; students ${after.maxStudents ?? "unlimited"}, teachers ${after.maxTeachers ?? "unlimited"}`);
  if (before.displayOrder !== after.displayOrder) lines.push(`Order: ${before.displayOrder} → ${after.displayOrder}`);
  if (before.description !== after.description || before.highlights.join("|") !== after.highlights.join("|")) lines.push("Description or highlights updated");
  return lines;
}

/**
 * Publish the draft (or a never-published plan as it is). Refused with the
 * reasons when the configuration breaks a rule. Changes the plan row only.
 */
export async function publishPlan(actor: SessionUser, planId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.plan.findUnique({ where: { id: planId }, select: PLAN_COLUMNS });
  if (!row) throw new NotFoundError();
  if (row.status === "ARCHIVED") throw new ConflictError("Restore this plan before publishing it.");
  if (!row.draft && row.status === "PUBLISHED") throw new ConflictError("There are no unpublished changes.");
  const before = liveConfig(row);
  const next = row.draft ? planConfig(before, row.draft) : before;
  const problems = planProblems(next, await ladder(planId), planId);
  if (problems.length) throw new AppError("CONFLICT", `Not published: ${problems.join(" ")}`);
  const impact = await impactOf(row, next);
  const rolesAdded = next.availableRoles.filter((key) => !before.availableRoles.includes(key));

  await prisma.$transaction(async (tx) => {
    // Claim the draft we validated: a concurrent edit makes this publish fail rather than publish unseen changes.
    const { count } = await tx.plan.updateMany({
      where: { id: planId, updatedAt: row.updatedAt },
      data: {
        name: next.name,
        description: next.description,
        highlights: next.highlights,
        displayOrder: next.displayOrder,
        priceMinor: next.priceMinor,
        priceOnRequest: next.priceOnRequest,
        billingPeriod: next.billingPeriod,
        campusLimit: next.campusLimit,
        extraCampusAllowed: next.extraCampusAllowed,
        extraCampusPriceMinor: next.extraCampusPriceMinor,
        extraCampusPeriod: next.extraCampusPeriod,
        maxCampuses: next.maxCampuses,
        optionalModules: next.optionalModules,
        features: next.features,
        maxStudents: next.maxStudents,
        maxTeachers: next.maxTeachers,
        maxAdmins: next.maxAdmins,
        storageMb: next.storageMb,
        availableRoles: next.availableRoles,
        roleLimits: next.roleLimits,
        status: "PUBLISHED",
        publishedAt: new Date(),
        draft: Prisma.DbNull,
        draftUpdatedAt: null,
        draftById: null,
      },
    });
    if (!count) throw new ConflictError("The plan changed while you were reviewing it. Reload and check again.");
    // Roles the plan adds are offered to campuses that follow the plan's roles. Additive only.
    if (rolesAdded.length) {
      const followers = await tx.school.findMany({ where: { rolesCustomized: false, subscriptions: { some: { planId, status: { in: [...LIVE] } } } }, select: { id: true, enabledRoles: true } });
      for (const school of followers) {
        const merged = cleanRoles([...school.enabledRoles, ...rolesAdded]);
        if (merged.length !== cleanRoles(school.enabledRoles).length) await tx.school.update({ where: { id: school.id }, data: { enabledRoles: merged } });
      }
    }
  });

  const changes = describeChanges(before, next);
  await recordAudit({
    action: "PLAN_PUBLISHED",
    entityType: "Plan",
    entityId: planId,
    actorId: actor.id,
    summary: `Plan "${next.name}" published.${changes.length ? ` ${changes.join(". ")}.` : ""}${impact.notes.length ? ` Impact: ${impact.notes.join(" ")}` : ""}`,
    metadata: { previous: before, next, impact: { organizations: impact.organizations, campuses: impact.campuses, grandfathered: impact.grandfathered.length, overCap: impact.overCap.length } } as unknown as Record<string, unknown>,
  });
  return { impact };
}

/** Open or close a published plan for new registrations and requests. Existing customers carry on. */
export async function setPlanActive(actor: SessionUser, planId: string, active: boolean) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true, name: true, status: true } });
  if (!row) throw new NotFoundError();
  if (row.status === "ARCHIVED" && active) throw new ConflictError("Restore this plan first.");
  await prisma.plan.update({ where: { id: planId }, data: { isActive: active } });
  await recordAudit({ action: active ? "PLAN_ACTIVATED" : "PLAN_DEACTIVATED", entityType: "Plan", entityId: planId, actorId: actor.id, summary: `Plan "${row.name}" ${active ? "opened" : "closed"} for new registrations. Existing customers are not affected.` });
}

/** Archive: hidden from everyone new; existing subscriptions stay as they are. */
export async function archivePlan(actor: SessionUser, planId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true, name: true, status: true } });
  if (!row) throw new NotFoundError();
  if (row.status === "ARCHIVED") return;
  const open = await prisma.planChangeRequest.count({ where: { requestedPlanId: planId, status: "PENDING" } });
  if (open) throw new ConflictError(`${open} plan request${open === 1 ? " is" : "s are"} waiting for this plan. Decide ${open === 1 ? "it" : "them"} first.`);
  await prisma.plan.update({ where: { id: planId }, data: { status: "ARCHIVED", isActive: false } });
  const usage = await planUsage(planId);
  await recordAudit({ action: "PLAN_ARCHIVED", entityType: "Plan", entityId: planId, actorId: actor.id, summary: `Plan "${row.name}" archived. ${usage.organizationCount} organization${usage.organizationCount === 1 ? "" : "s"} stay on it until moved.` });
}

/** Restore an archived plan as published but closed to new registrations. */
export async function restorePlan(actor: SessionUser, planId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const row = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true, name: true, status: true, publishedAt: true } });
  if (!row) throw new NotFoundError();
  if (row.status !== "ARCHIVED") return;
  await prisma.plan.update({ where: { id: planId }, data: { status: row.publishedAt ? "PUBLISHED" : "DRAFT", isActive: false } });
  await recordAudit({ action: "PLAN_RESTORED", entityType: "Plan", entityId: planId, actorId: actor.id, summary: `Plan "${row.name}" restored (closed to new registrations until opened).` });
}

export function describeModules(modules: readonly string[]): string {
  return modules.length ? modules.map(moduleLabel).join(", ") : "core only";
}
