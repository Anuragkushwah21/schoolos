import "server-only";

import { ForbiddenError } from "@/lib/errors";
import { type Action, type Area, can, isSchoolLeader, scopeOf } from "@/lib/permissions";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * Refuse unless the signed-in person may take this action across the whole
 * school (`lib/permissions.ts`) — the School Admin, or the Principal within
 * their areas.
 *
 * School-wide only: a teacher's "attendance: ASSIGNED" or a parent's
 * "homework: CHILDREN" never passes here, because those reach only their own
 * sections or children and are checked by the role's own services
 * (`requireTeacherSelf`, the parent/student access helpers).
 */
export function assertCan(ctx: Pick<TenantContext, "user">, area: Area, action: Action): void {
  const role = ctx.user.role;
  if (!isSchoolLeader(role) || scopeOf(role, area) !== "SCHOOL" || !can(role, area, action)) throw new ForbiddenError();
}
