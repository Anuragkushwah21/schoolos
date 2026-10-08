import type { Route } from "next";

/**
 * What a school can use, in two kinds:
 *
 *   * CORE modules are SchoolOS itself — every active school has them, and
 *     there is no switch for them.
 *   * OPTIONAL modules come with a plan (`Plan.optionalModules`), and the
 *     Super Admin may adjust them for one school (`School.optionalModules`,
 *     with `modulesCustomized` set). Only modules that exist in the product
 *     are listed: a key that is not here can never be switched on.
 *
 * Presentation and enforcement both read this one list: the sidebar hides a
 * module a school does not have, its pages show "not in your plan", and the
 * services refuse it (`server/platform/modules.ts`).
 */

export const CORE_MODULES = [
  { key: "STUDENTS", label: "Students", hint: "Admissions, records, promotion." },
  { key: "STAFF", label: "Teachers & staff", hint: "People, roles, permissions, leave." },
  { key: "ACADEMICS", label: "Academic structure", hint: "Sessions, classes, sections, subjects, timetable." },
  { key: "ATTENDANCE", label: "Attendance", hint: "Student and staff registers." },
  { key: "HOMEWORK", label: "Homework & learning", hint: "Homework, lessons, study material." },
  { key: "EXAMS", label: "Exams & results", hint: "Tests, marks, report cards." },
  { key: "PARENTS", label: "Parents", hint: "Family accounts and the parent app." },
  { key: "COMMUNICATION", label: "Communication", hint: "Notices, events, meetings, concerns." },
  { key: "REPORTS", label: "Basic reports", hint: "Attendance reports and downloads." },
  { key: "SETTINGS", label: "School settings", hint: "Profile, website, rules." },
] as const;

export const OPTIONAL_MODULES = [
  { key: "FINANCE", label: "Fees & finance", hint: "Fee structure, collection, receipts, dues." },
  { key: "EXPENSES", label: "Expenses", hint: "The school's spending and purchases." },
  { key: "PAYROLL", label: "Payroll", hint: "Salary structures and monthly salary payments." },
  { key: "LIBRARY", label: "Library", hint: "Books, copies, issue and return." },
  { key: "TRANSPORT", label: "Transport", hint: "Vehicles, routes, stops, drivers." },
  { key: "INVENTORY", label: "Inventory", hint: "Assets and equipment." },
] as const;

export type OptionalModule = (typeof OPTIONAL_MODULES)[number]["key"];
export const OPTIONAL_MODULE_KEYS = OPTIONAL_MODULES.map((module) => module.key) as OptionalModule[];

export function isOptionalModule(value: string): value is OptionalModule {
  return (OPTIONAL_MODULE_KEYS as string[]).includes(value);
}

/** Keep only real module keys, in catalogue order, without repeats. */
export function cleanModules(values: readonly string[]): OptionalModule[] {
  const wanted = new Set(values);
  return OPTIONAL_MODULE_KEYS.filter((key) => wanted.has(key));
}

export function moduleLabel(key: string): string {
  return OPTIONAL_MODULES.find((module) => module.key === key)?.label ?? key;
}

/**
 * Staff grants by module (the grant key's prefix): a staff permission in a
 * module the school does not have is refused, whoever holds it.
 */
export const GRANT_MODULE: Record<string, OptionalModule> = {
  fees: "FINANCE",
  expenses: "EXPENSES",
  payroll: "PAYROLL",
  library: "LIBRARY",
  transport: "TRANSPORT",
  inventory: "INVENTORY",
};

export function moduleOfGrant(grant: string): OptionalModule | null {
  return GRANT_MODULE[grant.split(".")[0] ?? ""] ?? null;
}

/**
 * The pages each optional module owns, for every role. A path under one of
 * these prefixes is that module's: hidden from the sidebar and closed by the
 * page guard when the school does not have it.
 */
export const MODULE_ROUTES: Record<OptionalModule, string[]> = {
  FINANCE: ["/school-admin/finance/payments", "/school-admin/finance/fees", "/school-admin/finance/receipts", "/school-admin/finance/family", "/school-admin/finance/carry-forward", "/staff/fees", "/parent/fees", "/receipts"],
  EXPENSES: ["/school-admin/finance/expenses", "/staff/expenses"],
  PAYROLL: ["/school-admin/finance/payroll", "/school-admin/finance/salaries", "/staff/payroll"],
  LIBRARY: ["/school-admin/library", "/staff/library", "/student/library"],
  TRANSPORT: ["/school-admin/transport", "/staff/transport", "/staff/my-route"],
  INVENTORY: ["/school-admin/inventory", "/staff/inventory"],
};

/** The optional module a path belongs to, if any. */
export function moduleOfPath(path: string): OptionalModule | null {
  for (const key of OPTIONAL_MODULE_KEYS) {
    if (MODULE_ROUTES[key].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return key;
  }
  return null;
}

/** Whether a sidebar link leads into a module the school does not have. */
export function hrefAllowed(href: Route | string, enabled: readonly string[]): boolean {
  const owner = moduleOfPath(String(href).split("?")[0]!);
  return owner === null || enabled.includes(owner);
}

/**
 * Starting points for each plan tier, used when the plans are first given
 * modules (the migration) and by seeds. The Super Admin edits them on
 * Features & Plans; nothing else in the app hard-codes a plan's modules.
 */
export const DEFAULT_TIER_MODULES: Record<"STARTER" | "STANDARD" | "PRO", OptionalModule[]> = {
  STARTER: ["FINANCE"],
  STANDARD: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"],
  PRO: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT", "INVENTORY"],
};

/** The money modules behind the School Admin's "Finance & Accounts" overview. */
const FINANCE_GROUP: OptionalModule[] = ["FINANCE", "EXPENSES", "PAYROLL"];

/**
 * A sidebar (or a row of tabs) without the modules the school does not have.
 * "Finance & Accounts" stays while any money module is on.
 */
export function withinModules<T extends { href: Route | string }>(items: readonly T[], enabled: readonly string[]): T[] {
  return items.filter((item) => {
    const path = String(item.href).split("?")[0]!;
    if (path === "/school-admin/finance" || path === "/staff/finance") return FINANCE_GROUP.some((key) => enabled.includes(key));
    return hrefAllowed(path, enabled);
  });
}
