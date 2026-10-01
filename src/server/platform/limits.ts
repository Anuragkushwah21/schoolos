import "server-only";

import { AppError } from "@/lib/errors";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

/**
 * Plan limits. A school on a plan with `maxStudents = 300` cannot add a 301st
 * active student. A school with no live subscription is not blocked — billing
 * is out of V1 and a missing record must not stop a school from working.
 */
export async function assertWithinPlanLimit(
  ctx: TenantContext,
  resource: "students" | "teachers",
): Promise<void> {
  const subscription = await prisma.subscription.findFirst({
    where: { schoolId: ctx.schoolId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
    select: { plan: { select: { name: true, maxStudents: true, maxTeachers: true } } },
  });
  if (!subscription) return;

  const limit =
    resource === "students" ? subscription.plan.maxStudents : subscription.plan.maxTeachers;
  if (limit === null) return;

  const count =
    resource === "students"
      ? await ctx.db.student.count({ where: { status: "ACTIVE" } })
      : await ctx.db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } });

  if (count >= limit) {
    throw new AppError(
      "CONFLICT",
      `Your ${subscription.plan.name} plan allows up to ${limit} active ${resource}. Contact SchoolOS to upgrade.`,
    );
  }
}

/**
 * How many more active students the school's plan allows, or null for no
 * limit. Bulk imports check the whole batch against this before writing.
 */
export async function remainingStudentCapacity(ctx: TenantContext): Promise<{ remaining: number; plan: string } | null> {
  const subscription = await prisma.subscription.findFirst({
    where: { schoolId: ctx.schoolId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
    select: { plan: { select: { name: true, maxStudents: true } } },
  });
  if (!subscription || subscription.plan.maxStudents === null) return null;
  const count = await ctx.db.student.count({ where: { status: "ACTIVE" } });
  return { remaining: Math.max(subscription.plan.maxStudents - count, 0), plan: subscription.plan.name };
}

/** How many more active teachers the plan allows, or null for no limit. */
export async function remainingTeacherCapacity(ctx: TenantContext): Promise<{ remaining: number; plan: string } | null> {
  const subscription = await prisma.subscription.findFirst({
    where: { schoolId: ctx.schoolId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
    select: { plan: { select: { name: true, maxTeachers: true } } },
  });
  if (!subscription || subscription.plan.maxTeachers === null) return null;
  const count = await ctx.db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } });
  return { remaining: Math.max(subscription.plan.maxTeachers - count, 0), plan: subscription.plan.name };
}
