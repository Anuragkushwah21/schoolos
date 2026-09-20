import "server-only";

import { NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

/**
 * The plan catalogue. Tiers are fixed (one row per `PlanTier`); the Super Admin
 * edits names, prices and limits. Deactivating a plan hides it from the
 * homepage and registration without touching schools already on it.
 */

export async function listPlans(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.plan.findMany({
    orderBy: { priceMinor: "asc" },
    include: {
      _count: { select: { subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING"] } } } } },
    },
  });
}

export async function updatePlan(
  actor: SessionUser,
  planId: string,
  input: {
    name: string;
    description: string | null;
    priceMinor: number;
    maxStudents: number | null;
    maxTeachers: number | null;
    maxAdmins: number | null;
    storageMb: number | null;
    isActive: boolean;
  },
): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");
  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } });
  if (!plan) throw new NotFoundError();

  await prisma.plan.update({ where: { id: planId }, data: input });
  await recordAudit({
    action: "PLAN_UPDATED",
    entityType: "Plan",
    entityId: planId,
    actorId: actor.id,
    summary: `Plan "${input.name}" updated.`,
  });
}
