import "server-only";

import { redirect } from "next/navigation";

import type { StaffPermission } from "@/generated/prisma/enums";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { employeeMaySignIn } from "@/lib/validation/lifecycle";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * Authorization for non-teaching staff logins.
 *
 * A NON_TEACHING_STAFF user is never a School Admin, whatever their
 * designation. Beyond their own record, notices and meetings they reach only
 * the modules listed in their `StaffMember.permissions`, and those are read
 * from the database on every call — never from the session, the URL or a form
 * — so a grant or a revocation takes effect on the very next request.
 */

const SELF_SELECT = {
  id: true,
  employeeId: true,
  firstName: true,
  lastName: true,
  role: true,
  designation: true,
  department: true,
  phone: true,
  email: true,
  joiningDate: true,
  status: true,
  permissions: true,
} as const;

/** The staff record behind the signed-in user. */
export async function requireStaffSelf(ctx: TenantContext) {
  assertRole(ctx.user, "NON_TEACHING_STAFF");
  const staff = await ctx.db.staffMember.findFirst({ where: { userId: ctx.user.id }, select: SELF_SELECT });
  // A staff login with no record is a half-finished setup; there is nothing to show.
  if (!staff) throw new NotFoundError("Your staff record is not set up yet. Ask the school office.");
  return staff;
}

/** What the signed-in staff member may open. Inactive staff hold nothing. */
export async function staffPermissions(ctx: TenantContext): Promise<StaffPermission[]> {
  if (ctx.user.role !== "NON_TEACHING_STAFF") return [];
  const staff = await ctx.db.staffMember.findFirst({ where: { userId: ctx.user.id }, select: { status: true, permissions: true } });
  // Only a current staff member holds permissions; suspended or former staff hold none.
  if (!staff || !employeeMaySignIn(staff.status)) return [];
  return staff.permissions;
}

/**
 * The gate for a module the School Admin runs and may open to staff: the admin
 * always passes; a staff member passes only with this permission; everyone else
 * is refused.
 */
export async function assertAdminOrStaffPermission(ctx: TenantContext, permission: StaffPermission): Promise<void> {
  if (ctx.user.role === "SCHOOL_ADMIN") return;
  if (ctx.user.role === "NON_TEACHING_STAFF" && (await staffPermissions(ctx)).includes(permission)) return;
  throw new ForbiddenError();
}

/**
 * Page guard for a granted module: a staff member without the permission is
 * sent to their dashboard, as `requireRole` does for a wrong role, so probing
 * `/staff/library` reveals nothing.
 */
export async function requireStaffModule(ctx: TenantContext, permission: StaffPermission): Promise<void> {
  if (!(await staffPermissions(ctx)).includes(permission)) redirect("/staff/dashboard");
}
