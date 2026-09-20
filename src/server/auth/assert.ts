import type { UserRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/errors";
import type { SessionUser } from "@/server/auth/session";

/**
 * Defence in depth for the data access layer.
 *
 * Pages and actions already pass through `requireTenant*()` with a role list,
 * but a service function must not assume every future caller remembered to.
 * Each one re-asserts the roles it serves, so adding a new caller cannot
 * widen who reaches it.
 */
export function assertRole(user: SessionUser, ...roles: readonly UserRole[]): void {
  if (!roles.includes(user.role)) throw new ForbiddenError();
}
