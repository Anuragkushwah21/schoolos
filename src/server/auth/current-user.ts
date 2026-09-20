import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import type { UserRole } from "@/generated/prisma/enums";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { roleHomePath } from "@/lib/roles";
import {
  SESSION_COOKIE_NAME,
  type SessionUser,
  validateSessionToken,
} from "@/server/auth/session";
import { forSchool, type TenantDb } from "@/server/tenancy/scope";

/**
 * The authorization gate. Everything private in the app passes through here.
 *
 * `cache()` makes this once-per-request: a layout, a page and several Server
 * Actions in the same request share one database lookup, and — more
 * importantly — none of them has to pass the user down as a prop, which is how
 * privileged objects end up in Client Components by accident.
 *
 * These guards use `redirect()` and `notFound()` rather than Next's
 * `unauthorized()` / `forbidden()`, which still require the experimental
 * `authInterrupts` flag. The core authorization path of a production system
 * should not depend on an experimental toggle, and the redirect behaviour is
 * better anyway: a signed-out visitor lands on the login form instead of a
 * dead 401 page.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return validateSessionToken(token);
});

/** Require a signed-in user, sending anyone else to the login form. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Require one of `roles`.
 *
 * A signed-in user who lacks the role is sent to their own dashboard rather
 * than shown an error: a teacher probing `/platform` learns nothing about
 * whether that section exists.
 */
export async function requireRole(
  ...roles: readonly UserRole[]
): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(roleHomePath(user.role));
  return user;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  return requireRole("SUPER_ADMIN");
}

/**
 * The tenant context every school-scoped page and action starts from.
 *
 * `schoolId` comes from the session row in the database — never from the URL,
 * the request body or a form field — and `db` is already scoped to it, so a
 * caller cannot reach another school's data even by writing a careless query.
 */
export type TenantContext = {
  user: SessionUser;
  schoolId: string;
  schoolSlug: string;
  schoolName: string;
  db: TenantDb;
};

export async function requireTenant(
  ...roles: readonly UserRole[]
): Promise<TenantContext> {
  const user = roles.length ? await requireRole(...roles) : await requireUser();

  // SUPER_ADMIN has no school; platform pages use requireSuperAdmin instead.
  if (!user.schoolId) redirect(roleHomePath(user.role));

  return {
    user,
    schoolId: user.schoolId,
    schoolSlug: user.schoolSlug ?? "",
    schoolName: user.schoolName ?? "",
    db: forSchool(user.schoolId),
  };
}

/**
 * Assert that a lookup scoped to the tenant actually found something.
 *
 * Renders the 404 page when it did not. A record belonging to another school
 * is indistinguishable from one that does not exist, so probing ids never
 * confirms what another school holds.
 */
export function assertFound<T>(record: T | null | undefined): T {
  if (record === null || record === undefined) notFound();
  return record;
}

/**
 * Server Action variants.
 *
 * Actions return `ActionResult` rather than navigating, so these throw
 * `AppError`s that `runAction()` turns into a safe message. A page's guard
 * does not protect the actions defined alongside it: a Server Action is a
 * separate POST endpoint and must re-verify its own caller.
 */
export async function requireUserForAction(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

export async function requireRoleForAction(
  ...roles: readonly UserRole[]
): Promise<SessionUser> {
  const user = await requireUserForAction();
  if (!roles.includes(user.role)) throw new ForbiddenError();
  return user;
}

export async function requireTenantForAction(
  ...roles: readonly UserRole[]
): Promise<TenantContext> {
  const user = roles.length
    ? await requireRoleForAction(...roles)
    : await requireUserForAction();

  if (!user.schoolId) throw new ForbiddenError();

  return {
    user,
    schoolId: user.schoolId,
    schoolSlug: user.schoolSlug ?? "",
    schoolName: user.schoolName ?? "",
    db: forSchool(user.schoolId),
  };
}

/** Send an already-signed-in visitor to their own dashboard. */
export async function redirectIfAuthenticated(): Promise<void> {
  const user = await getCurrentUser();
  if (user) redirect(roleHomePath(user.role));
}
