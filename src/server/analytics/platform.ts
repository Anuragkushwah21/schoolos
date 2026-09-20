import "server-only";

import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

/**
 * Platform-wide aggregates for the Super Admin dashboard.
 *
 * Counts across every school, never a school's own records: the platform owner
 * governs tenants, and this file exists to keep that line visible.
 */

/** Registrations and approvals per month, oldest first. */
export async function schoolGrowth(actor: SessionUser, months = 12) {
  assertRole(actor, "SUPER_ADMIN");

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  const [registered, approved] = await Promise.all([
    prisma.school.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.school.findMany({
      where: { reviewedAt: { gte: start }, status: "ACTIVE" },
      select: { reviewedAt: true },
    }),
  ]);

  const monthKey = (date: Date) =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

  const buckets = new Map<string, { registered: number; approved: number }>();
  for (let index = 0; index < months; index += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    buckets.set(monthKey(date), { registered: 0, approved: 0 });
  }

  for (const row of registered) {
    const bucket = buckets.get(monthKey(row.createdAt));
    if (bucket) bucket.registered += 1;
  }
  for (const row of approved) {
    const bucket = row.reviewedAt ? buckets.get(monthKey(row.reviewedAt)) : undefined;
    if (bucket) bucket.approved += 1;
  }

  return [...buckets.entries()].map(([key, value]) => {
    const [year, month] = key.split("-").map(Number) as [number, number];
    const date = new Date(Date.UTC(year, month - 1, 1));
    return {
      key,
      label: new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short" }).format(date),
      fullLabel: new Intl.DateTimeFormat("en-IN", {
        timeZone: "UTC",
        month: "long",
        year: "numeric",
      }).format(date),
      ...value,
    };
  });
}

export async function schoolsByStatus(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");

  const rows = await prisma.school.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0;

  return {
    total: rows.reduce((sum, row) => sum + row._count._all, 0),
    active: count("ACTIVE"),
    awaitingReview: count("PENDING") + count("UNDER_REVIEW"),
    suspended: count("SUSPENDED") + count("INACTIVE"),
    rejected: count("REJECTED"),
  };
}

/** Active and trialing subscriptions per plan, for the plan mix. */
export async function planDistribution(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");

  const plans = await prisma.plan.findMany({
    orderBy: { priceMinor: "asc" },
    select: {
      id: true,
      name: true,
      priceMinor: true,
      currency: true,
      _count: {
        select: { subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING"] } } } },
      },
    },
  });

  return plans.map((plan) => ({
    id: plan.id,
    label: plan.name,
    value: plan._count.subscriptions,
    priceMinor: plan.priceMinor,
    currency: plan.currency,
  }));
}

/** How much the platform is carrying, across every school. */
export async function platformTotals(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");

  const [students, teachers, parents, users, liveTokens] = await Promise.all([
    prisma.student.count({ where: { status: "ACTIVE" } }),
    prisma.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
    prisma.parent.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.apiToken.count({ where: { revokedAt: null } }),
  ]);

  return { students, teachers, parents, users, liveTokens };
}

/** The busiest schools by active students — where the load actually is. */
export async function largestSchools(actor: SessionUser, take = 6) {
  assertRole(actor, "SUPER_ADMIN");

  const schools = await prisma.school.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      city: true,
      _count: { select: { students: true, teachers: true } },
    },
  });

  return schools
    .map((school) => ({
      id: school.id,
      label: school.name,
      city: school.city,
      value: school._count.students,
      teachers: school._count.teachers,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, take);
}
