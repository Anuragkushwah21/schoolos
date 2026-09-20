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
