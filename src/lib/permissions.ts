import type { UserRole } from "@/generated/prisma/enums";

/**
 * Who may do what, in one place: role → area → actions, with the data scope
 * each role works within. Server code asks `can()` (via `assertCan` in
 * `server/auth/permissions.ts`); the sidebar and dashboards follow the same
 * table. Tenant isolation sits underneath all of it (`ctx.db` is always one
 * school's), feature access on top (`server/platform/modules.ts`), and
 * non-teaching staff get their areas from the grants the School Admin gives
 * them (`lib/staff-access.ts`) rather than from this table.
 *
 *   Super Admin decides WHAT a school can use (its modules).
 *   School Admin decides WHO inside the school can use it.
 *   This table decides what each role sees and does; the scope narrows it.
 */

export type Action = "VIEW" | "CREATE" | "EDIT" | "DELETE" | "APPROVE" | "PUBLISH" | "EXPORT";

export type Area =
  | "platform"
  | "students"
  | "staff"
  | "academics"
  | "attendance"
  | "homework"
  | "exams"
  | "finance"
  | "communication"
  | "reports"
  | "settings"
  | "users"
  | "responsibilities";

/** Whose records a role reaches within an area. */
export type Scope = "PLATFORM" | "SCHOOL" | "ASSIGNED" | "CHILDREN" | "SELF" | "GRANTED";

type Grant = { actions: readonly Action[]; scope: Scope };

const ALL: readonly Action[] = ["VIEW", "CREATE", "EDIT", "DELETE", "APPROVE", "PUBLISH", "EXPORT"];
const VIEW: readonly Action[] = ["VIEW"];
/** Everything but deleting records. */
const LEAD: readonly Action[] = ["VIEW", "CREATE", "EDIT", "APPROVE", "PUBLISH", "EXPORT"];
const school = (actions: readonly Action[]): Grant => ({ actions, scope: "SCHOOL" });

export const ROLE_PERMISSIONS: Record<UserRole, Partial<Record<Area, Grant>>> = {
  // The platform only: schools, plans, modules, platform reports and audit.
  SUPER_ADMIN: { platform: { actions: ALL, scope: "PLATFORM" } },
  // Runs the school: everything inside it.
  SCHOOL_ADMIN: {
    students: school(ALL),
    staff: school(ALL),
    academics: school(ALL),
    attendance: school(ALL),
    homework: school(ALL),
    exams: school(ALL),
    finance: school(ALL),
    communication: school(ALL),
    reports: school(ALL),
    settings: school(ALL),
    users: school(ALL),
    responsibilities: school(ALL),
  },
  // A working school leader (academics, students, teachers, exams,
  // communication, leave, delegation) — not the School Admin: no fee
  // collection or configuration, payroll, expenses, settings, users or
  // non-teaching staff permissions, and no deleting student or teacher
  // records. Finance is a high-level overview only.
  PRINCIPAL: {
    students: school(LEAD),
    staff: school(LEAD),
    academics: school(ALL),
    attendance: school(LEAD),
    homework: school(ALL),
    exams: school(LEAD),
    finance: school(VIEW),
    communication: school(ALL),
    reports: school(["VIEW", "EXPORT"]),
    responsibilities: school(ALL),
  },
  // Their own classes, sections and subjects only.
  TEACHER: {
    students: { actions: VIEW, scope: "ASSIGNED" },
    academics: { actions: VIEW, scope: "ASSIGNED" },
    attendance: { actions: ["VIEW", "CREATE", "EDIT"], scope: "ASSIGNED" },
    homework: { actions: ["VIEW", "CREATE", "EDIT", "DELETE"], scope: "ASSIGNED" },
    exams: { actions: ["VIEW", "CREATE", "EDIT"], scope: "ASSIGNED" },
    communication: { actions: VIEW, scope: "SCHOOL" },
  },
  // Their linked children only — fees included.
  PARENT: {
    students: { actions: VIEW, scope: "CHILDREN" },
    attendance: { actions: VIEW, scope: "CHILDREN" },
    homework: { actions: VIEW, scope: "CHILDREN" },
    exams: { actions: VIEW, scope: "CHILDREN" },
    finance: { actions: VIEW, scope: "CHILDREN" },
    communication: { actions: VIEW, scope: "SCHOOL" },
  },
  // Their own record only — and never finance.
  STUDENT: {
    students: { actions: VIEW, scope: "SELF" },
    academics: { actions: VIEW, scope: "SELF" },
    attendance: { actions: VIEW, scope: "SELF" },
    homework: { actions: VIEW, scope: "SELF" },
    exams: { actions: VIEW, scope: "SELF" },
    communication: { actions: VIEW, scope: "SCHOOL" },
  },
  // Areas come from the School Admin's grants for each person.
  NON_TEACHING_STAFF: {},
};

export function can(role: UserRole, area: Area, action: Action): boolean {
  return ROLE_PERMISSIONS[role][area]?.actions.includes(action) ?? false;
}

export function scopeOf(role: UserRole, area: Area): Scope | null {
  return ROLE_PERMISSIONS[role][area]?.scope ?? null;
}

/**
 * Staff grants the Principal holds by role, for the services the School Admin
 * shares with staff: admissions and enquiries, meetings (PTM), the student
 * directory, and the fee overview (view only — never collecting, charging,
 * expenses or payroll).
 */
export const PRINCIPAL_GRANTS: readonly string[] = [
  "fees.view",
  "students.directory",
  "students.contact",
  "enquiries.view",
  "enquiries.manage",
  "admissions.view",
  "admissions.manage",
  "meetings.schedule",
];

/**
 * The roles that run a school day to day: the School Admin, and the
 * Principal where the school has one. Where code used to mean "the School
 * Admin sees the whole school", it means this; what each may change is still
 * decided by `can()`. A school without a Principal loses nothing — the
 * School Admin holds every one of these permissions.
 */
export const SCHOOL_LEADERS = ["SCHOOL_ADMIN", "PRINCIPAL"] as const;

export function isSchoolLeader(role: UserRole): boolean {
  return role === "SCHOOL_ADMIN" || role === "PRINCIPAL";
}
