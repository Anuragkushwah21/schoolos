import type { Route } from "next";

import type { UserRole } from "@/generated/prisma/enums";

/**
 * Role metadata shared by server guards and client navigation.
 *
 * Kept free of server imports so the login form can redirect without pulling
 * the database layer into the client bundle.
 */

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<UserRole, Route> = {
  SUPER_ADMIN: "/super-admin/dashboard",
  SCHOOL_ADMIN: "/school-admin/dashboard",
  TEACHER: "/teacher/dashboard",
  STUDENT: "/student/dashboard",
  PARENT: "/parent/dashboard",
  NON_TEACHING_STAFF: "/staff/dashboard",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  SCHOOL_ADMIN: "School Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
  PARENT: "Parent",
  NON_TEACHING_STAFF: "Staff",
};

/** Where a user lands after signing in, and after hitting a bare `/`. */
export function roleHomePath(role: UserRole): Route {
  return ROLE_HOME[role];
}

/**
 * Where "My profile" goes for each role.
 *
 * Four roles have a profile page of their own because they have a record the
 * school holds about them — a staff record, a guardian record, an enrolment.
 * The two administrator roles do not: what they would look at is their own
 * login, which is `/account` and is shared by every role. Pointing them there
 * is deliberate, rather than building two more profile pages that would only
 * duplicate it.
 */
export const ROLE_PROFILE: Record<UserRole, Route> = {
  SUPER_ADMIN: "/account",
  SCHOOL_ADMIN: "/account",
  TEACHER: "/teacher/profile",
  STUDENT: "/student/profile",
  PARENT: "/parent/profile",
  NON_TEACHING_STAFF: "/staff/profile",
};

export function roleProfilePath(role: UserRole): Route {
  return ROLE_PROFILE[role];
}

/** Roles that belong to a school. SUPER_ADMIN governs the platform instead. */
export const TENANT_ROLES: readonly UserRole[] = [
  "SCHOOL_ADMIN",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "NON_TEACHING_STAFF",
];

export function isTenantRole(role: UserRole): boolean {
  return TENANT_ROLES.includes(role);
}

/**
 * The URL prefix each role owns. `proxy.ts` uses this for its optimistic
 * redirect; the real check still happens server-side on every request.
 *
 * Deliberately separate from `ROLE_HOME`: a role's landing page may sit
 * deeper than the area it owns. The teacher's and the staff member's do — everything under
 * `/teacher` is theirs, and `/teacher/dashboard` is where they start — and
 * aliasing the two would make the prefix `/teacher/dashboard`, which matches
 * none of their other pages.
 */
export const ROLE_PATH_PREFIX: Record<UserRole, string> = {
  SUPER_ADMIN: "/super-admin",
  SCHOOL_ADMIN: "/school-admin",
  TEACHER: "/teacher",
  STUDENT: "/student",
  PARENT: "/parent",
  NON_TEACHING_STAFF: "/staff",
};
