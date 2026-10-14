/**
 * The plan catalogue's rules, shared by the Super Admin's Plan Builder, the
 * public comparison (homepage, registration, demo) and the server checks.
 * Pure functions only — no database — so every screen and every test reads
 * the same definitions.
 *
 * Three things are kept apart:
 *
 *   * CORE modules (lib/school-modules.ts) — every plan, always on.
 *   * OPTIONAL modules — a plan makes them *eligible*; each campus then has
 *     the ones it has switched on (`School.optionalModules`). An upgrade
 *     grants eligibility, never switches anything on by itself.
 *   * Plan FEATURES — organization-level capabilities (below), not campus
 *     modules.
 */
import { CORE_MODULES, OPTIONAL_MODULES, type OptionalModule, cleanModules, moduleLabel } from "@/lib/school-modules";
import { type Limits, type OptionalRole, OPTIONAL_ROLE_KEYS, cleanLimits, cleanRoles, roleLabel } from "@/lib/school-roles";

export const BILLING_PERIODS = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type BillingPeriodKey = (typeof BILLING_PERIODS)[number];

export function periodLabel(period: BillingPeriodKey): string {
  return period === "MONTHLY" ? "month" : period === "QUARTERLY" ? "quarter" : "year";
}

/** Organization-level capabilities a plan can include. Stable keys; labels may change. */
export const PLAN_FEATURES = [
  { key: "ORG_DASHBOARD", label: "Organization dashboard", hint: "One summary across all campuses for the owner." },
  { key: "FEATURE_REQUESTS", label: "Custom feature requests", hint: "Ask SchoolOS for something new and track it. Cost and scope are agreed separately." },
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number]["key"];
export const PLAN_FEATURE_KEYS = PLAN_FEATURES.map((feature) => feature.key) as PlanFeature[];

export function cleanFeatures(values: readonly string[] | null | undefined): PlanFeature[] {
  const wanted = new Set(values ?? []);
  return PLAN_FEATURE_KEYS.filter((key) => wanted.has(key));
}

export function featureLabel(key: string): string {
  return PLAN_FEATURES.find((feature) => feature.key === key)?.label ?? key;
}

/**
 * Optional modules every plan must make eligible: a school cannot run its
 * day without fees and expense records, so no plan may drop them.
 */
export const ESSENTIAL_MODULES: readonly OptionalModule[] = ["FINANCE", "EXPENSES"];

/**
 * Modules that need another module. None of today's optional modules depend
 * on each other in the code, so the map is empty — the check is here so a
 * future module that does is refused without its dependency.
 */
export const MODULE_DEPENDS: Partial<Record<OptionalModule, readonly OptionalModule[]>> = {};

/** Group headings for the comparison table, so it is not one long list. */
export const MODULE_CATEGORIES: Array<{ title: string; core: readonly string[]; optional: readonly OptionalModule[] }> = [
  { title: "Students & families", core: ["STUDENTS", "PARENTS"], optional: [] },
  { title: "Teaching & learning", core: ["ACADEMICS", "ATTENDANCE", "HOMEWORK", "EXAMS"], optional: [] },
  { title: "Office & accounts", core: ["STAFF"], optional: ["FINANCE", "EXPENSES", "PAYROLL"] },
  { title: "Communication & reports", core: ["COMMUNICATION", "REPORTS", "SETTINGS"], optional: [] },
  { title: "Facilities", core: [], optional: ["LIBRARY", "TRANSPORT", "INVENTORY"] },
];

/** Every core and optional module, in category order — for the full comparison. */
export function catalogueRows() {
  return MODULE_CATEGORIES.map((category) => ({
    title: category.title,
    rows: [
      ...category.core.map((key) => {
        const entry = CORE_MODULES.find((row) => row.key === key)!;
        return { key, label: entry.label, hint: entry.hint, core: true as const };
      }),
      ...category.optional.map((key) => {
        const entry = OPTIONAL_MODULES.find((row) => row.key === key)!;
        return { key, label: entry.label, hint: entry.hint, core: false as const };
      }),
    ],
  }));
}

/** What the Plan Builder edits — the same shape is stored as a plan's draft. */
export type PlanConfig = {
  name: string;
  description: string | null;
  highlights: string[];
  displayOrder: number;
  priceMinor: number;
  priceOnRequest: boolean;
  billingPeriod: BillingPeriodKey;
  campusLimit: number;
  extraCampusAllowed: boolean;
  extraCampusPriceMinor: number | null;
  extraCampusPeriod: BillingPeriodKey;
  maxCampuses: number | null;
  optionalModules: OptionalModule[];
  features: PlanFeature[];
  maxStudents: number | null;
  maxTeachers: number | null;
  maxAdmins: number | null;
  storageMb: number | null;
  availableRoles: OptionalRole[];
  roleLimits: Limits;
};

const int = (value: unknown, fallback: number | null): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback);
const period = (value: unknown, fallback: BillingPeriodKey): BillingPeriodKey => ((BILLING_PERIODS as readonly unknown[]).includes(value) ? (value as BillingPeriodKey) : fallback);

/** A plan's configuration: its live columns, overlaid with a draft when given. */
export function planConfig(plan: PlanConfig, draft?: unknown): PlanConfig {
  if (!draft || typeof draft !== "object") return { ...plan, optionalModules: cleanModules(plan.optionalModules), features: cleanFeatures(plan.features), availableRoles: cleanRoles(plan.availableRoles), roleLimits: cleanLimits(plan.roleLimits) };
  const d = draft as Record<string, unknown>;
  return {
    name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : plan.name,
    description: typeof d.description === "string" ? d.description || null : d.description === null ? null : plan.description,
    highlights: Array.isArray(d.highlights) ? d.highlights.filter((row): row is string => typeof row === "string" && row.trim() !== "").map((row) => row.trim()).slice(0, 8) : plan.highlights,
    displayOrder: int(d.displayOrder, plan.displayOrder)!,
    priceMinor: Math.max(0, int(d.priceMinor, plan.priceMinor)!),
    priceOnRequest: typeof d.priceOnRequest === "boolean" ? d.priceOnRequest : plan.priceOnRequest,
    billingPeriod: period(d.billingPeriod, plan.billingPeriod),
    campusLimit: Math.max(1, int(d.campusLimit, plan.campusLimit)!),
    extraCampusAllowed: typeof d.extraCampusAllowed === "boolean" ? d.extraCampusAllowed : plan.extraCampusAllowed,
    extraCampusPriceMinor: "extraCampusPriceMinor" in d ? int(d.extraCampusPriceMinor, null) : plan.extraCampusPriceMinor,
    extraCampusPeriod: period(d.extraCampusPeriod, plan.extraCampusPeriod),
    maxCampuses: "maxCampuses" in d ? int(d.maxCampuses, null) : plan.maxCampuses,
    optionalModules: Array.isArray(d.optionalModules) ? cleanModules(d.optionalModules as string[]) : cleanModules(plan.optionalModules),
    features: Array.isArray(d.features) ? cleanFeatures(d.features as string[]) : cleanFeatures(plan.features),
    maxStudents: "maxStudents" in d ? int(d.maxStudents, null) : plan.maxStudents,
    maxTeachers: "maxTeachers" in d ? int(d.maxTeachers, null) : plan.maxTeachers,
    maxAdmins: "maxAdmins" in d ? int(d.maxAdmins, null) : plan.maxAdmins,
    storageMb: "storageMb" in d ? int(d.storageMb, null) : plan.storageMb,
    availableRoles: Array.isArray(d.availableRoles) ? cleanRoles(d.availableRoles as string[]) : cleanRoles(plan.availableRoles),
    roleLimits: d.roleLimits && typeof d.roleLimits === "object" ? cleanLimits(d.roleLimits) : cleanLimits(plan.roleLimits),
  };
}

/**
 * Problems with a plan's configuration, given the other published plans.
 * Plans are a ladder by display order: each must keep everything the plan
 * below it makes eligible (modules and features), no two plans share a
 * place in the order, every plan keeps the essential modules, and
 * dependencies must be present.
 */
export function planProblems(
  config: PlanConfig,
  others: ReadonlyArray<{ id: string; name: string; displayOrder: number; optionalModules: readonly string[]; features: readonly string[] }>,
  selfId: string | null,
  depends: Partial<Record<OptionalModule, readonly OptionalModule[]>> = MODULE_DEPENDS,
): string[] {
  const problems: string[] = [];
  if (config.name.trim().length < 2) problems.push("Give the plan a name.");
  const modules = new Set<string>(config.optionalModules);
  const missingEssential = ESSENTIAL_MODULES.filter((key) => !modules.has(key));
  if (missingEssential.length) problems.push(`Every plan must include ${missingEssential.map(moduleLabel).join(" and ")} — schools cannot run without them.`);
  for (const key of config.optionalModules) {
    const needs = (depends[key] ?? []).filter((dep) => !modules.has(dep));
    if (needs.length) problems.push(`${moduleLabel(key)} needs ${needs.map(moduleLabel).join(", ")}.`);
  }
  if (!config.priceOnRequest && config.priceMinor <= 0) problems.push("Set a price, or mark the plan “Price on request”.");
  if (config.extraCampusAllowed && (config.extraCampusPriceMinor === null || config.extraCampusPriceMinor < 0)) problems.push("Set the price of an extra campus (0 if extra campuses are free).");
  // The cap only counts when extra campuses are allowed (`campusPolicy`).
  if (config.extraCampusAllowed && config.maxCampuses !== null && config.maxCampuses < config.campusLimit) problems.push("The campus cap cannot be lower than the included campuses.");

  const ladder = others.filter((row) => row.id !== selfId);
  // Two plans at the same place have no "below" or "above", so the ladder
  // rule could not be checked between them.
  const sameOrder = ladder.filter((row) => row.displayOrder === config.displayOrder);
  if (sameOrder.length) problems.push(`Display order ${config.displayOrder} is already used by ${sameOrder.map((row) => row.name).join(" and ")}. Give each plan its own place in the order.`);
  const below = ladder.filter((row) => row.displayOrder < config.displayOrder).sort((a, b) => b.displayOrder - a.displayOrder)[0];
  const above = ladder.filter((row) => row.displayOrder > config.displayOrder).sort((a, b) => a.displayOrder - b.displayOrder)[0];
  if (below) {
    const lostModules = cleanModules(below.optionalModules).filter((key) => !modules.has(key));
    const lostFeatures = cleanFeatures(below.features).filter((key) => !config.features.includes(key));
    if (lostModules.length || lostFeatures.length) problems.push(`${config.name} must include everything in ${below.name}: missing ${[...lostModules.map(moduleLabel), ...lostFeatures.map(featureLabel)].join(", ")}.`);
  }
  if (above) {
    const notAbove = config.optionalModules.filter((key) => !above.optionalModules.includes(key));
    const featuresNotAbove = config.features.filter((key) => !above.features.includes(key));
    if (notAbove.length || featuresNotAbove.length) problems.push(`${above.name} (the next plan up) would no longer include everything in ${config.name}: ${[...notAbove.map(moduleLabel), ...featuresNotAbove.map(featureLabel)].join(", ")}. Add them to ${above.name} first.`);
  }
  return problems;
}

/** How many campuses an organization may run on a plan, and whether extras cost. */
export function campusPolicy(plan: Pick<PlanConfig, "campusLimit" | "extraCampusAllowed" | "extraCampusPriceMinor" | "extraCampusPeriod" | "maxCampuses">, override: number | null = null) {
  const included = plan.campusLimit;
  // The Super Admin's override for one organization is a hard cap.
  const cap = override ?? (plan.extraCampusAllowed ? plan.maxCampuses : included);
  return { included, cap, extraAllowed: plan.extraCampusAllowed, extraPriceMinor: plan.extraCampusPriceMinor, extraPeriod: plan.extraCampusPeriod, overridden: override !== null };
}

/**
 * The price breakdown for an organization with `campuses` campuses on a
 * plan: the plan fee once (never added across plans) plus each campus past
 * the included ones. `onRequest` means no number may be shown.
 */
export function quote(plan: Pick<PlanConfig, "priceMinor" | "priceOnRequest" | "billingPeriod" | "campusLimit" | "extraCampusAllowed" | "extraCampusPriceMinor" | "extraCampusPeriod">, campuses: number) {
  const extraCampuses = Math.max(0, campuses - plan.campusLimit);
  const extraEach = plan.extraCampusAllowed ? (plan.extraCampusPriceMinor ?? 0) : null;
  return {
    onRequest: plan.priceOnRequest,
    planFeeMinor: plan.priceOnRequest ? null : plan.priceMinor,
    billingPeriod: plan.billingPeriod,
    includedCampuses: plan.campusLimit,
    extraCampuses,
    extraEachMinor: extraEach,
    extraPeriod: plan.extraCampusPeriod,
    extraTotalMinor: extraEach === null ? null : extraEach * extraCampuses,
  };
}

export function campusAllowanceText(plan: Pick<PlanConfig, "campusLimit" | "extraCampusAllowed" | "maxCampuses">): string {
  const included = plan.campusLimit === 1 ? "1 campus included" : `${plan.campusLimit} campuses included`;
  if (!plan.extraCampusAllowed) return included;
  return `${included}; more${plan.maxCampuses !== null ? ` up to ${plan.maxCampuses}` : ""} at an extra charge`;
}

/** A slug from a plan name: lowercase letters, digits and dashes. */
export function planSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plan";
}

/**
 * Plan templates: the starting configuration for Starter, Growth and Pro.
 * They fill a new plan's form (and "Restore defaults"); a plan's saved
 * configuration is never replaced by a template unless the Super Admin
 * chooses to and saves. Only what SchoolOS really enforces per plan is here:
 * optional modules, organization features, roles and campuses. Everything
 * in the core (students, attendance, exams, report cards, PTM, admissions,
 * notices, calendar, needs attention…) is in every plan.
 *
 * Starter is a complete school (fees and expenses included); Growth adds a
 * second campus, payroll, the library and the organization dashboard; Pro
 * adds a third campus, transport, inventory and custom feature requests.
 * No prices and no student limits are suggested — those are the Super
 * Admin's to set.
 */
const STARTER_ROLES: OptionalRole[] = ["PRINCIPAL", "ACCOUNTANT", "RECEPTIONIST", "OFFICE_STAFF", "PEON", "SECURITY", "COORDINATOR", "OTHER"];

export const PLAN_TEMPLATES = {
  starter: { label: "Starter", tier: "STARTER", displayOrder: 1, description: "Everything a school needs for its daily work.", campusLimit: 1, optionalModules: ["FINANCE", "EXPENSES"] as OptionalModule[], features: [] as PlanFeature[], availableRoles: STARTER_ROLES },
  growth: { label: "Growth", tier: "STANDARD", displayOrder: 2, description: "For owners running more than one campus.", campusLimit: 2, optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"] as OptionalModule[], features: ["ORG_DASHBOARD"] as PlanFeature[], availableRoles: [...STARTER_ROLES, "LIBRARIAN"] as OptionalRole[] },
  pro: { label: "Pro", tier: "PRO", displayOrder: 3, description: "For school groups that need every standard module.", campusLimit: 3, optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT", "INVENTORY"] as OptionalModule[], features: ["ORG_DASHBOARD", "FEATURE_REQUESTS"] as PlanFeature[], availableRoles: [...OPTIONAL_ROLE_KEYS] as OptionalRole[] },
} as const;

export type PlanTemplateKey = keyof typeof PLAN_TEMPLATES;
export const PLAN_TEMPLATE_KEYS = Object.keys(PLAN_TEMPLATES) as PlanTemplateKey[];

export function isPlanTemplateKey(value: unknown): value is PlanTemplateKey {
  return typeof value === "string" && (PLAN_TEMPLATE_KEYS as string[]).includes(value);
}

/** The parts of a plan a template sets. */
export function templateSelection(key: PlanTemplateKey) {
  const template = PLAN_TEMPLATES[key];
  return { optionalModules: [...template.optionalModules], features: [...template.features], availableRoles: cleanRoles(template.availableRoles), campusLimit: template.campusLimit };
}

/** How a configuration differs from its template — what "Customized" means. */
export function templateDiff(config: Pick<PlanConfig, "optionalModules" | "features" | "availableRoles" | "campusLimit">, key: string | null) {
  if (!isPlanTemplateKey(key)) return null;
  const template = templateSelection(key);
  const diff = <T extends string>(now: readonly T[], base: readonly T[]) => ({ added: now.filter((item) => !base.includes(item)), removed: base.filter((item) => !now.includes(item)) });
  const modules = diff(config.optionalModules, template.optionalModules);
  const features = diff(config.features, template.features);
  const roles = diff(cleanRoles(config.availableRoles), template.availableRoles);
  const campuses = config.campusLimit !== template.campusLimit ? { from: template.campusLimit, to: config.campusLimit } : null;
  const customized = Boolean(modules.added.length || modules.removed.length || features.added.length || features.removed.length || roles.added.length || roles.removed.length || campuses);
  return { template: PLAN_TEMPLATES[key].label, customized, modules, features, roles, campuses };
}

/**
 * Roles that only make sense with a module: a Librarian without the Library
 * has nothing to do. Advice, not a rule — a plan may still offer the role.
 */
export const ROLE_NEEDS_MODULE: Partial<Record<OptionalRole, OptionalModule>> = {
  LIBRARIAN: "LIBRARY",
  DRIVER: "TRANSPORT",
  TRANSPORT_ATTENDANT: "TRANSPORT",
  LAB_ASSISTANT: "INVENTORY",
};

/** Things worth a second look that do not stop publishing. */
export function planWarnings(config: Pick<PlanConfig, "optionalModules" | "availableRoles">): string[] {
  const modules = new Set<string>(config.optionalModules);
  return cleanRoles(config.availableRoles)
    .filter((role) => ROLE_NEEDS_MODULE[role] && !modules.has(ROLE_NEEDS_MODULE[role]!))
    .map((role) => `The ${roleLabel(role)} role is offered without ${moduleLabel(ROLE_NEEDS_MODULE[role]!)}, so that staff member would have nothing to do. Add ${moduleLabel(ROLE_NEEDS_MODULE[role]!)} or remove the role.`);
}

/** What each optional module covers, for the Plan Builder's "what's inside" — read-only. */
export const MODULE_CAPABILITIES: Record<OptionalModule, string[]> = {
  FINANCE: ["Fee heads, instalments and due dates", "Concessions and late fees", "Receipts, family payment and carry-forward", "Dues, class-wise and daily collection reports", "Parents' fee statements"],
  EXPENSES: ["Expense and purchase records", "Expense reports"],
  PAYROLL: ["Salary structures", "Monthly salary payments"],
  LIBRARY: ["Books and copies", "Issue, return and fines", "Library reports"],
  TRANSPORT: ["Vehicles, routes and stops", "Students on each route", "Driver's route and trip log"],
  INVENTORY: ["Assets and equipment records"],
};

/**
 * The defaults for a new database (scripts and seeds only): Starter is a
 * complete school, Growth adds a second campus and the organization
 * dashboard, Pro a third campus and custom feature requests. No prices: a
 * fresh plan is "Price on request" until the Super Admin sets one.
 */
export const DEFAULT_PLANS = PLAN_TEMPLATE_KEYS.map((key) => {
  const template = PLAN_TEMPLATES[key];
  return { tier: template.tier, slug: key, templateKey: key, name: template.label, displayOrder: template.displayOrder, campusLimit: template.campusLimit, description: template.description, optionalModules: [...template.optionalModules], features: [...template.features], availableRoles: [...template.availableRoles] };
});
