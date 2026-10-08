import { STAFF_ROLE_NAMES } from "@/lib/staff-access";

/**
 * Which kinds of people a campus may have, and how many — set by the plan,
 * adjustable per campus by the Super Admin. Kept apart from permissions (what
 * a role may do, lib/permissions.ts) and modules (what functionality exists,
 * lib/school-modules.ts).
 *
 *   Super Admin decides WHAT a campus can use (modules, roles, limits).
 *   School Admin decides WHO inside the campus gets those roles.
 *
 * These are the fixed system roles — a plan never creates a new role.
 */

/** Always available: without them SchoolOS is not a school. */
export const CORE_ROLES = [
  { key: "SCHOOL_ADMIN", label: "School Admin" },
  { key: "TEACHER", label: "Teacher" },
  { key: "PARENT", label: "Parent" },
  { key: "STUDENT", label: "Student" },
] as const;

/** Switchable per plan / campus: the Principal and each staff designation. */
export const OPTIONAL_ROLES = [
  { key: "PRINCIPAL", label: "Principal" },
  ...(Object.entries(STAFF_ROLE_NAMES) as Array<[keyof typeof STAFF_ROLE_NAMES, string]>).map(([key, label]) => ({ key, label })),
] as const satisfies ReadonlyArray<{ key: string; label: string }>;

export type OptionalRole = (typeof OPTIONAL_ROLES)[number]["key"];
export const OPTIONAL_ROLE_KEYS = OPTIONAL_ROLES.map((role) => role.key) as OptionalRole[];

export function cleanRoles(values: readonly string[]): OptionalRole[] {
  const wanted = new Set(values);
  return OPTIONAL_ROLE_KEYS.filter((key) => wanted.has(key));
}

export function roleLabel(key: string): string {
  return OPTIONAL_ROLES.find((role) => role.key === key)?.label ?? CORE_ROLES.find((role) => role.key === key)?.label ?? key;
}

/**
 * What can be limited. STUDENTS and TEACHERS count active people; STAFF counts
 * all current non-teaching staff; a role key counts people in that role.
 */
export const LIMIT_KEYS = [
  { key: "STUDENTS", label: "Students" },
  { key: "TEACHERS", label: "Teachers" },
  { key: "STAFF", label: "Non-teaching staff (all)" },
  ...OPTIONAL_ROLES,
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number]["key"];
const LIMIT_KEY_SET = new Set<string>(LIMIT_KEYS.map((limit) => limit.key));

export function limitLabel(key: string): string {
  return LIMIT_KEYS.find((limit) => limit.key === key)?.label ?? key;
}

/** A limits map (key → positive whole number), dropping unknown keys and blanks. */
export type Limits = Partial<Record<LimitKey, number>>;
export function cleanLimits(value: unknown): Limits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Limits = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (LIMIT_KEY_SET.has(key) && Number.isInteger(number) && number >= 0) out[key as LimitKey] = number;
  }
  return out;
}

/** Limits from form fields named `limit.<KEY>`. */
export function limitsFromForm(formData: FormData): Limits {
  const raw: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("limit.") && typeof value === "string") raw[name.slice(6)] = value;
  }
  return cleanLimits(raw);
}

export function describeLimits(limits: Limits): string {
  const entries = Object.entries(limits);
  return entries.length ? entries.map(([key, value]) => `${limitLabel(key)} ${value}`).join(", ") : "no limits";
}
