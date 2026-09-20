import type { UserRole } from "@/generated/prisma/enums";

/**
 * Role metadata shared by server guards and client navigation.
 *
 * Kept free of server imports so the login form can redirect without pulling
 * the database layer into the client bundle.
 */

export const ROLE_HOME: Record<UserRole, string> = {
  SUPER_ADMIN: "/platform",
  SCHOOL_ADMIN: "/admin",
  TEACHER: "/teacher",
  STUDENT: "/student",
  PARENT: "/parent",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  SCHOOL_ADMIN: "School Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
  PARENT: "Parent",
};

/** Where a user lands after signing in, and after hitting a bare `/`. */
export function roleHomePath(role: UserRole): string {
  return ROLE_HOME[role];
}

/** Roles that belong to a school. SUPER_ADMIN governs the platform instead. */
export const TENANT_ROLES: readonly UserRole[] = [
  "SCHOOL_ADMIN",
  "TEACHER",
  "STUDENT",
  "PARENT",
];

export function isTenantRole(role: UserRole): boolean {
  return TENANT_ROLES.includes(role);
}

/**
 * The URL prefix each role owns. `proxy.ts` uses this for its optimistic
 * redirect; the real check still happens server-side on every request.
 */
export const ROLE_PATH_PREFIX: Record<UserRole, string> = ROLE_HOME;
