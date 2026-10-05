import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { today } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { type StaffGrant, allowedGrants } from "@/lib/staff-access";
import { employeeMaySignIn } from "@/lib/validation/lifecycle";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * Authorization for non-teaching staff logins.
 *
 * A NON_TEACHING_STAFF user is never a School Admin, whatever their role.
 * Beyond their own record, attendance, leave, notices, events and meetings
 * they reach only what their grants allow (`@/lib/staff-access`):
 *
 *   * the grants stored on their record, which the School Admin edits;
 *   * plus the temporary grants of a substitution that is active today —
 *     worked out from its dates, so it starts and expires by itself;
 *   * minus whatever their designation can never hold.
 *
 * All of it is read from the database on every request — never from the
 * session, the URL or a form — so a change takes effect on the next request.
 * Grants open a module; what the module returns is narrowed again where it
 * matters (a driver's students are only those on their route).
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
  grants: true,
  roleProfileId: true,
} as const;

/** The staff record behind the signed-in user. */
export async function requireStaffSelf(ctx: TenantContext) {
  assertRole(ctx.user, "NON_TEACHING_STAFF");
  const staff = await ctx.db.staffMember.findFirst({ where: { userId: ctx.user.id }, select: SELF_SELECT });
  // A staff login with no record is a half-finished setup; there is nothing to show.
  if (!staff) throw new NotFoundError("Your staff record is not set up yet. Ask the school office.");
  return staff;
}

/** Substitutions running on `date` (not ended early) where this person is the substitute. */
export async function activeSubstitutionsAsSubstitute(ctx: TenantContext, staffId: string, date: Date = today()) {
  return ctx.db.staffSubstitution.findMany({
    where: { substituteStaffId: staffId, endedAt: null, startDate: { lte: date }, endDate: { gte: date }, original: { schoolId: ctx.schoolId } },
    select: { id: true, originalStaffId: true, grants: true, coverRoutes: true, endDate: true, original: { select: { firstName: true, lastName: true, role: true } } },
  });
}

/** Grants for a staff record: own plus today's substitutions, minus what the role can never hold. */
export async function effectiveGrantsFor(ctx: TenantContext, staff: { id: string; role: string; status: string; grants: readonly string[] }): Promise<StaffGrant[]> {
  // Only a current staff member holds anything; suspended or former staff hold none.
  if (!employeeMaySignIn(staff.status)) return [];
  const substitutions = await activeSubstitutionsAsSubstitute(ctx, staff.id);
  return allowedGrants(staff.role, [...staff.grants, ...substitutions.flatMap((row) => row.grants)]);
}

/** What the signed-in staff member may do right now (cached for one render). */
export const staffGrants = cache(async (ctx: TenantContext): Promise<StaffGrant[]> => {
  if (ctx.user.role !== "NON_TEACHING_STAFF") return [];
  const staff = await ctx.db.staffMember.findFirst({ where: { userId: ctx.user.id }, select: { id: true, status: true, role: true, grants: true } });
  if (!staff) return [];
  return effectiveGrantsFor(ctx, staff);
});

/** Whether the signed-in staff member holds any of these grants. */
export async function staffHolds(ctx: TenantContext, grant: StaffGrant | readonly StaffGrant[]): Promise<boolean> {
  const wanted: readonly StaffGrant[] = typeof grant === "string" ? [grant] : grant;
  const held = await staffGrants(ctx);
  return wanted.some((key) => held.includes(key));
}

/**
 * The gate for a module the School Admin runs and may open to staff: the admin
 * always passes; a staff member passes only with one of these grants; everyone
 * else is refused.
 */
export async function assertAdminOrStaffPermission(ctx: TenantContext, grant: StaffGrant | readonly StaffGrant[]): Promise<void> {
  if (ctx.user.role === "SCHOOL_ADMIN") return;
  if (ctx.user.role === "NON_TEACHING_STAFF" && (await staffHolds(ctx, grant))) return;
  throw new ForbiddenError();
}

/** The gate for a staff-only feature (their route, their riders): staff with the grant, nobody else. */
export async function assertStaffGrant(ctx: TenantContext, grant: StaffGrant | readonly StaffGrant[]): Promise<void> {
  assertRole(ctx.user, "NON_TEACHING_STAFF");
  if (!(await staffHolds(ctx, grant))) throw new ForbiddenError();
}

/**
 * Page guard for a granted module: a staff member without the grant is sent
 * to their dashboard, as `requireRole` does for a wrong role, so probing
 * `/staff/library` reveals nothing.
 */
export async function requireStaffModule(ctx: TenantContext, grant: StaffGrant | readonly StaffGrant[]): Promise<void> {
  if (!(await staffHolds(ctx, grant))) redirect("/staff/dashboard");
}
