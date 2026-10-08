import "server-only";

import type { TenantContext } from "@/server/auth/current-user";
import { assertWithinLimit, remainingCapacity } from "@/server/platform/entitlements";

/**
 * Plan limits for students and teachers. A campus on a plan with
 * `maxStudents = 300` cannot add a 301st active student; the Super Admin may
 * set a different limit for one campus. The general mechanism, including
 * staff and role limits, lives in `server/platform/entitlements.ts`.
 */
export async function assertWithinPlanLimit(ctx: TenantContext, resource: "students" | "teachers"): Promise<void> {
  await assertWithinLimit(ctx, resource === "students" ? "STUDENTS" : "TEACHERS");
}

/** How many more active students the campus may add, or null for no limit. Bulk imports check the whole batch. */
export async function remainingStudentCapacity(ctx: TenantContext): Promise<{ remaining: number; plan: string } | null> {
  const capacity = await remainingCapacity(ctx.schoolId, "STUDENTS");
  return capacity ? { remaining: capacity.remaining, plan: capacity.plan ?? "school" } : null;
}

/** How many more active teachers the campus may add, or null for no limit. */
export async function remainingTeacherCapacity(ctx: TenantContext): Promise<{ remaining: number; plan: string } | null> {
  const capacity = await remainingCapacity(ctx.schoolId, "TEACHERS");
  return capacity ? { remaining: capacity.remaining, plan: capacity.plan ?? "school" } : null;
}
