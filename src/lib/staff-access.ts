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

export const STAFF_MODULES = ["library", "students", "admissions", "meetings", "security", "transport", "fees", "expenses", "payroll", "inventory"] as const;
export type StaffModule = (typeof STAFF_MODULES)[number];

export const STAFF_MODULE_LABEL: Record<StaffModule, string> = {
  library: "Library",
  students: "Students",
  admissions: "Enquiries & admissions",
  meetings: "Meetings / PTM",
  security: "Visitors & gate",
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
  // --- Enquiries & admissions -------------------------------------------------
  { key: "enquiries.view", module: "admissions", action: "VIEW", label: "Walk-in enquiries", hint: "Family enquiries with their children, follow-ups and status." },
  { key: "enquiries.manage", module: "admissions", action: "EDIT", label: "Add & follow up enquiries", hint: "Record new enquiries, edit them, add follow-ups and change their status. Fees, discounts and admitting a child stay with the School Admin." },
  { key: "enquiries.fees", module: "admissions", action: "MANAGE", label: "Discuss fees & discounts on enquiries", hint: "Record the fee discussed with a family and any discount. Applying it to real fee records stays with the School Admin." },
  { key: "admissions.view", module: "admissions", action: "VIEW", label: "Online applications & status", hint: "Applications from the website and where each one stands." },
  { key: "admissions.manage", module: "admissions", action: "EDIT", label: "Move applications along", hint: "Change an application's status (review, shortlist, approve, reject) and add follow-ups. Admitting a student stays with the School Admin." },
  // --- Meetings --------------------------------------------------------------
  { key: "meetings.schedule", module: "meetings", action: "CREATE", label: "Schedule meetings", hint: "Schedule meetings and PTMs, and change or cancel the ones they scheduled. Deleting a meeting stays with the School Admin." },
  // --- Visitors & gate --------------------------------------------------------
  { key: "visitors.view", module: "security", action: "VIEW", label: "Visitor log", hint: "Who came in, whom they met, entry and exit times. Nothing about students' studies, fees or marks." },
  { key: "visitors.manage", module: "security", action: "EDIT", label: "Record visitor entry & exit", hint: "Log a visitor in, mark them out, correct an entry. Every change is audited." },
  // --- Transport -------------------------------------------------------------
  { key: "transport.myroute", module: "transport", action: "VIEW", label: "My route & stops", hint: "The route they drive or attend (or cover as a substitute): vehicle, stops and times.", scope: "Own route only" },
  { key: "transport.riders", module: "transport", action: "VIEW", label: "Students on my route", hint: "Name, class, section and stop of the students on their route — nobody else.", scope: "Own route's students only" },
  { key: "transport.contacts", module: "transport", action: "VIEW", label: "Emergency contact of my riders", hint: "Primary guardian's name and phone for students on their route.", scope: "Own route's students only" },
  { key: "transport.trips", module: "transport", action: "EDIT", label: "Pickup & drop status", hint: "Mark picked up, not present, dropped or an issue — today, on their route." },
  { key: "transport.routes", module: "transport", action: "VIEW", label: "All routes (read-only)", hint: "Every route, stop and vehicle with rider counts. No student names." },
  // --- Fees ------------------------------------------------------------------
  { key: "fees.view", module: "fees", action: "VIEW", label: "Fee dashboard & pending fees", hint: "What each student owes, payment history and receipts. Read-only." },
  { key: "fees.collect", module: "fees", action: "CREATE", label: "Collect fees & print receipts", hint: "Record payments (single and family) and print receipts." },
  { key: "fees.manage", module: "fees", action: "MANAGE", label: "Fee structure & charges", hint: "Add fee heads, charge a class, section or one student, remove a wrong charge, void a wrong receipt, carry forward old dues." },
  { key: "fees.concessions", module: "fees", action: "EDIT", label: "Give fee concessions", hint: "A discount on a student's fee, with a reason — audited, and shown with who approved it." },
  { key: "fees.reports", module: "fees", action: "EXPORT", label: "Finance reports", hint: "Download fee, payment — and, with those permissions, expense and salary — reports." },
  // --- Expenses --------------------------------------------------------------
  { key: "expenses.view", module: "expenses", action: "VIEW", label: "View expenses", hint: "The school's spending, by month and category." },
  { key: "expenses.create", module: "expenses", action: "CREATE", label: "Record expenses", hint: "Add an expense with its bill details." },
  { key: "expenses.delete", module: "expenses", action: "DELETE", label: "Remove expenses", hint: "Remove an expense recorded by mistake." },
  // --- Payroll ---------------------------------------------------------------
  { key: "payroll.view", module: "payroll", action: "VIEW", label: "View payroll & salaries", hint: "Monthly payroll and what each teacher and staff member is paid." },
  { key: "payroll.pay", module: "payroll", action: "MANAGE", label: "Record salary payments", hint: "Pay a month's salaries from the payroll." },
  // --- Inventory -------------------------------------------------------------
  { key: "inventory.view", module: "inventory", action: "VIEW", label: "View inventory", hint: "Equipment, furniture and lab items with their condition and location." },
  { key: "inventory.manage", module: "inventory", action: "MANAGE", label: "Manage inventory", hint: "Add and edit items, mark them in repair, lost or disposed." },
] as const satisfies readonly GrantDef[];

export type StaffGrant = (typeof DEFS)[number]["key"];
export const STAFF_GRANTS: readonly GrantDef[] = DEFS;
export const STAFF_GRANT_KEYS = DEFS.map((def) => def.key) as StaffGrant[];

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
  // The school's accounts, all of it (7 Oct 2026): fees, expenses and
  // purchases, paying salaries, reports. The School Admin keeps every bit of
  // it too, and can take any of it away from one accountant. Salary
  // structures stay with the School Admin.
  ACCOUNTANT: ["fees.view", "fees.collect", "fees.manage", "fees.concessions", "fees.reports", "expenses.view", "expenses.create", "expenses.delete", "payroll.view", "payroll.pay"],
  RECEPTIONIST: ["enquiries.view", "enquiries.manage", "admissions.view", "admissions.manage", "students.directory", "students.contact"],
  LAB_ASSISTANT: ["inventory.view", "inventory.manage"],
  SECURITY: ["visitors.view", "visitors.manage"],
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
  RECEPTIONIST: ["admissions", "students", "meetings", "security"],
  LAB_ASSISTANT: ["inventory"],
  SECURITY: ["security"],
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
  LIBRARIAN: ["students.directory", "students.contact", "transport.myroute", "transport.riders", "transport.contacts", "transport.trips", "transport.routes", "fees.view", "fees.collect", "fees.manage", "fees.concessions", "fees.reports", "expenses.view", "expenses.create", "expenses.delete", "payroll.view", "payroll.pay"],
  DRIVER: ["students.directory", "students.contact"],
  TRANSPORT_ATTENDANT: ["students.directory", "students.contact"],
  // Security and support staff never see student finances; security never
  // guardians' phone numbers, family enquiries or applications either.
  SECURITY: ["students.contact", "enquiries.view", "enquiries.manage", "admissions.view", "admissions.manage", "meetings.schedule", "enquiries.fees", "fees.view", "fees.collect", "fees.manage", "fees.concessions", "fees.reports", "expenses.view", "expenses.create", "expenses.delete", "payroll.view", "payroll.pay"],
  PEON: ["enquiries.fees", "fees.view", "fees.collect", "fees.manage", "fees.concessions", "fees.reports", "expenses.view", "expenses.create", "expenses.delete", "payroll.view", "payroll.pay"],
};

/**
 * Role defaults this code shipped before (newest last). A school's built-in
 * role profile still holding exactly one of these was never edited by its
 * admin, so `ensureRoleProfiles` brings it up to the current default; a
 * profile the admin changed is left alone.
 */
export const PREVIOUS_ROLE_DEFAULT_GRANTS: Partial<Record<BaseStaffRole, StaffGrant[][]>> = {
  ACCOUNTANT: [
    ["fees.view", "fees.collect"],
    ["fees.view", "fees.collect", "fees.reports", "expenses.view", "expenses.create", "payroll.view"],
    ["fees.view", "fees.collect", "fees.reports", "expenses.view", "expenses.create"],
    ["fees.view", "fees.collect", "fees.reports", "expenses.view", "expenses.create", "expenses.delete", "payroll.view", "payroll.pay"],
  ],
  RECEPTIONIST: [["students.directory"]],
  LAB_ASSISTANT: [["inventory.view"]],
  SECURITY: [[]],
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

/**
 * Role defaults against what one person actually holds: the defaults their
 * role gives (those this designation may hold), what the admin added on top,
 * what the admin took away, and the effective set. Used for the summary on a
 * staff profile and to carry custom changes across a change of role.
 */
export function permissionSummary(role: string, roleDefaults: readonly string[], grants: readonly string[]) {
  const defaults = allowedGrants(role, roleDefaults);
  const effective = allowedGrants(role, grants);
  return {
    defaults,
    added: effective.filter((key) => !defaults.includes(key)),
    removed: defaults.filter((key) => !effective.includes(key)),
    effective,
  };
}

/**
 * The workspace each designation works in — what the role "is for", shown to
 * the staff member and the admin. Their default responsibilities (grants)
 * open it; the admin can add or remove responsibilities per person. Support
 * staff get no broad workspace: only the common staff pages.
 */
export const STAFF_ROLE_WORKSPACE: Record<BaseStaffRole, string> = {
  ACCOUNTANT: "Finance",
  RECEPTIONIST: "Front Desk",
  OFFICE_STAFF: "Front Desk",
  LIBRARIAN: "Library",
  DRIVER: "Transport (own route)",
  TRANSPORT_ATTENDANT: "Transport (own route)",
  SECURITY: "Gate & Security",
  LAB_ASSISTANT: "Lab & Inventory",
  COORDINATOR: "Academic",
  PEON: "Support duties",
  OTHER: "As assigned",
};
