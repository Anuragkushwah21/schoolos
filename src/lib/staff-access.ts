/**
 * What a non-teaching staff member may do, as module × action grants.
 *
 * Every key here gates something real: a page, a service call or an API
 * route checks it on the server. Nothing in this file grants anything by
 * itself — a staff member holds the keys stored on their record (`grants`),
 * plus those of an active substitution, minus what their designation can
 * never hold (`STAFF_ROLE_EXCLUDED`). The School Admin edits both the role's
 * defaults and each person's grants.
 *
 * Client-safe: the permission screens render from it too.
 */

export type StaffAction = "VIEW" | "CREATE" | "EDIT" | "DELETE" | "EXPORT" | "PRINT" | "MANAGE";

type GrantDef = {
  key: string;
  module: StaffModule;
  action: StaffAction;
  label: string;
  hint: string;
  /** Shown as "Limited": the server narrows what this returns. */
  scope?: string;
};

export const STAFF_MODULES = ["library", "students", "transport", "fees", "expenses", "payroll", "inventory"] as const;
export type StaffModule = (typeof STAFF_MODULES)[number];

export const STAFF_MODULE_LABEL: Record<StaffModule, string> = {
  library: "Library",
  students: "Students",
  transport: "Transport",
  fees: "Fees",
  expenses: "Expenses",
  payroll: "Payroll & salary",
  inventory: "Inventory & lab",
};

const DEFS = [
  // --- Library ---------------------------------------------------------------
  { key: "library.view", module: "library", action: "VIEW", label: "Library dashboard, books & loans", hint: "Catalogue, copies, who has which book, overdue books and issue history." },
  { key: "library.circulation", module: "library", action: "MANAGE", label: "Issue, return & renew books", hint: "Includes the issue desk's borrower search (name, admission no., class)." },
  { key: "library.books.create", module: "library", action: "CREATE", label: "Add books", hint: "Add titles and copies, import a spreadsheet." },
  { key: "library.books.edit", module: "library", action: "EDIT", label: "Edit books", hint: "Title, author, category, shelf and number of copies." },
  { key: "library.copies", module: "library", action: "DELETE", label: "Lost & damaged copies", hint: "Take a copy out of stock or put it back. Its loans stay on record." },
  { key: "library.fines", module: "library", action: "MANAGE", label: "Fine management", hint: "Mark late fines and charges as paid." },
  { key: "library.reports", module: "library", action: "EXPORT", label: "Library reports", hint: "Download the catalogue, overdue and fines lists." },
  // --- Students --------------------------------------------------------------
  { key: "students.directory", module: "students", action: "VIEW", label: "Student directory — basic", hint: "Name, admission no. and class of every current student. No fees, marks or records.", scope: "Basic details only" },
  { key: "students.contact", module: "students", action: "VIEW", label: "Student directory — guardian contact", hint: "Adds the primary guardian's name and phone to the directory." },
  // --- Transport -------------------------------------------------------------
  { key: "transport.myroute", module: "transport", action: "VIEW", label: "My route & stops", hint: "The route they drive or attend (or cover as a substitute): vehicle, stops and times.", scope: "Own route only" },
  { key: "transport.riders", module: "transport", action: "VIEW", label: "Students on my route", hint: "Name, class, section and stop of the students on their route — nobody else.", scope: "Own route's students only" },
  { key: "transport.contacts", module: "transport", action: "VIEW", label: "Emergency contact of my riders", hint: "Primary guardian's name and phone for students on their route.", scope: "Own route's students only" },
  { key: "transport.trips", module: "transport", action: "EDIT", label: "Pickup & drop status", hint: "Mark picked up, not present, dropped or an issue — today, on their route." },
  { key: "transport.routes", module: "transport", action: "VIEW", label: "All routes (read-only)", hint: "Every route, stop and vehicle with rider counts. No student names." },
  // --- Fees ------------------------------------------------------------------
  { key: "fees.view", module: "fees", action: "VIEW", label: "Fee dashboard & pending fees", hint: "What each student owes, payment history and receipts. Read-only." },
  { key: "fees.collect", module: "fees", action: "CREATE", label: "Collect fees & print receipts", hint: "Record payments (single and family) and print receipts." },
  // --- Expenses --------------------------------------------------------------
  { key: "expenses.view", module: "expenses", action: "VIEW", label: "View expenses", hint: "The school's spending, by month and category." },
  { key: "expenses.create", module: "expenses", action: "CREATE", label: "Record expenses", hint: "Add an expense with its bill details." },
  { key: "expenses.delete", module: "expenses", action: "DELETE", label: "Remove expenses", hint: "Remove an expense recorded by mistake." },
  // --- Payroll ---------------------------------------------------------------
  { key: "payroll.view", module: "payroll", action: "VIEW", label: "View payroll & salaries", hint: "Monthly payroll and what each teacher is paid." },
  { key: "payroll.pay", module: "payroll", action: "MANAGE", label: "Record salary payments", hint: "Pay a month's salaries from the payroll." },
  // --- Inventory -------------------------------------------------------------
  { key: "inventory.view", module: "inventory", action: "VIEW", label: "View inventory", hint: "Equipment, furniture and lab items with their condition and location." },
  { key: "inventory.manage", module: "inventory", action: "MANAGE", label: "Manage inventory", hint: "Add and edit items, mark them in repair, lost or disposed." },
] as const satisfies readonly GrantDef[];

export type StaffGrant = (typeof DEFS)[number]["key"];
export const STAFF_GRANTS: readonly GrantDef[] = DEFS;
export const STAFF_GRANT_KEYS = DEFS.map((def) => def.key) as StaffGrant[];
const KEYS = new Set<string>(STAFF_GRANT_KEYS);

export function isStaffGrant(value: string): value is StaffGrant {
  return KEYS.has(value);
}

export function grantDef(key: string): GrantDef | undefined {
  return STAFF_GRANTS.find((def) => def.key === key);
}

/** Only known keys, without duplicates, in catalogue order. */
export function cleanGrants(values: readonly string[]): StaffGrant[] {
  const wanted = new Set(values);
  return STAFF_GRANT_KEYS.filter((key) => wanted.has(key));
}

// -----------------------------------------------------------------------------
// Designations
// -----------------------------------------------------------------------------

/** The built-in designations (the `StaffRole` enum), as the screens name them. */
export const STAFF_ROLE_NAMES = {
  LIBRARIAN: "Librarian",
  DRIVER: "Driver",
  TRANSPORT_ATTENDANT: "Transport attendant",
  ACCOUNTANT: "Accountant",
  RECEPTIONIST: "Receptionist",
  LAB_ASSISTANT: "Lab assistant",
  SECURITY: "Security",
  PEON: "Support staff",
  OFFICE_STAFF: "Office staff",
  COORDINATOR: "Coordinator",
  OTHER: "Other",
} as const;
export type BaseStaffRole = keyof typeof STAFF_ROLE_NAMES;

/** What a new role profile (and so a new staff member in it) starts with. */
export const STAFF_ROLE_DEFAULT_GRANTS: Record<BaseStaffRole, StaffGrant[]> = {
  LIBRARIAN: ["library.view", "library.circulation", "library.books.create", "library.books.edit", "library.copies", "library.fines", "library.reports"],
  DRIVER: ["transport.myroute", "transport.riders", "transport.trips"],
  TRANSPORT_ATTENDANT: ["transport.myroute", "transport.riders", "transport.trips"],
  ACCOUNTANT: ["fees.view", "fees.collect"],
  RECEPTIONIST: ["students.directory"],
  LAB_ASSISTANT: ["inventory.view"],
  SECURITY: [],
  PEON: [],
  OFFICE_STAFF: [],
  COORDINATOR: [],
  OTHER: [],
};

/** The modules a designation is mostly about — shown first on its permission screens. */
export const STAFF_ROLE_MODULES: Record<BaseStaffRole, StaffModule[]> = {
  LIBRARIAN: ["library"],
  DRIVER: ["transport"],
  TRANSPORT_ATTENDANT: ["transport"],
  ACCOUNTANT: ["fees", "expenses", "payroll"],
  RECEPTIONIST: ["students"],
  LAB_ASSISTANT: ["inventory"],
  SECURITY: [],
  PEON: [],
  OFFICE_STAFF: ["students"],
  COORDINATOR: ["students"],
  OTHER: [],
};

/**
 * What a designation can never hold, whatever is ticked, given as a role
 * profile default or lent by a substitution. A Librarian finds borrowers
 * through the issue desk, never the school-wide directory, and has no part in
 * transport or finance; a driver or attendant sees only the students on
 * their own route.
 */
export const STAFF_ROLE_EXCLUDED: Partial<Record<BaseStaffRole, readonly StaffGrant[]>> = {
  LIBRARIAN: ["students.directory", "students.contact", "transport.myroute", "transport.riders", "transport.contacts", "transport.trips", "transport.routes", "fees.view", "fees.collect", "expenses.view", "expenses.create", "expenses.delete", "payroll.view", "payroll.pay"],
  DRIVER: ["students.directory", "students.contact"],
  TRANSPORT_ATTENDANT: ["students.directory", "students.contact"],
};

/** Whether this designation may hold this grant at all. */
export function staffRoleMayHold(role: string, grant: string): boolean {
  const excluded = STAFF_ROLE_EXCLUDED[role as BaseStaffRole] as readonly string[] | undefined;
  return !excluded?.includes(grant);
}

/** The grants a designation may hold, in catalogue order. */
export function allowedGrants(role: string, grants: readonly string[]): StaffGrant[] {
  return cleanGrants(grants).filter((grant) => staffRoleMayHold(role, grant));
}

/**
 * The permissions this system replaced (`StaffMember.permissions`), and what
 * each one meant in grants — used once to carry existing staff over, and to
 * accept the old names from API clients.
 */
export const LEGACY_PERMISSION_GRANTS: Record<string, StaffGrant[]> = {
  VIEW_STUDENTS: ["students.directory", "students.contact"],
  VIEW_LIBRARY: ["library.view"],
  MANAGE_LIBRARY: ["library.view", "library.circulation", "library.books.create", "library.books.edit", "library.copies", "library.fines"],
  VIEW_TRANSPORT: ["transport.routes"],
  COLLECT_FEES: ["fees.view", "fees.collect"],
};

/** Old permission names or grant keys, as grant keys. */
export function grantsFrom(values: readonly string[]): StaffGrant[] {
  return cleanGrants(values.flatMap((value) => LEGACY_PERMISSION_GRANTS[value] ?? [value]));
}
