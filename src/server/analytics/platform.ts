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

/**
 * One row per school for the Super Admin's tracker: who they are, how big,
 * and how much fee money has gone through SchoolOS for them.
 *
 * Rejected registrations are left out — they never became schools. "Joined"
 * is the day the school was approved (or registered, if not yet approved);
 * "revenue" is the sum of the school's own fee receipts, because the platform
 * records no subscription payments of its own.
 */
export async function schoolTracker(actor: SessionUser, filters: { q?: string | null } = {}) {
  assertRole(actor, "SUPER_ADMIN");

  const q = filters.q?.trim();
  const [schools, revenue] = await Promise.all([
    prisma.school.findMany({
      where: {
        status: { not: "REJECTED" },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { udiseCode: { contains: q } },
                { city: { contains: q, mode: "insensitive" } },
                { state: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        udiseCode: true,
        establishedYear: true,
        affiliationBoard: true,
        createdAt: true,
        reviewedAt: true,
        addressLine: true,
        city: true,
        state: true,
        postalCode: true,
        email: true,
        phone: true,
        principalName: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, plan: { select: { name: true } } },
        },
        users: {
          where: { role: "SCHOOL_ADMIN" },
          orderBy: { createdAt: "asc" },
          select: { firstName: true, lastName: true, email: true, phone: true, isActive: true },
        },
        _count: {
          select: {
            students: { where: { status: "ACTIVE" } },
            teachers: { where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } },
          },
        },
      },
    }),
    prisma.feePayment.groupBy({ by: ["schoolId"], where: { voidedAt: null }, _sum: { amountMinor: true } }),
  ]);

  const revenueBySchool = new Map(revenue.map((row) => [row.schoolId, row._sum.amountMinor ?? 0]));

  const rows = schools.map((school) => ({
    id: school.id,
    name: school.name,
    slug: school.slug,
    status: school.status,
    udiseCode: school.udiseCode,
    establishedYear: school.establishedYear,
    board: school.affiliationBoard,
    joinedOn: school.reviewedAt && school.status !== "PENDING" ? school.reviewedAt : school.createdAt,
    location: [school.city, school.state].filter(Boolean).join(", "),
    students: school._count.students,
    teachers: school._count.teachers,
    revenueMinor: revenueBySchool.get(school.id) ?? 0,
    plan: school.subscriptions[0]?.plan.name ?? null,
    owner: {
      name: school.contactName,
      email: school.contactEmail,
      phone: school.contactPhone,
      principal: school.principalName,
      schoolEmail: school.email,
      schoolPhone: school.phone,
      address: [school.addressLine, school.city, school.state, school.postalCode]
        .filter(Boolean)
        .join(", "),
      admins: school.users.map((user) => ({
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        phone: user.phone,
        isActive: user.isActive,
      })),
    },
  }));

  return {
    rows,
    totals: {
      schools: rows.length,
      students: rows.reduce((sum, row) => sum + row.students, 0),
      teachers: rows.reduce((sum, row) => sum + row.teachers, 0),
      revenueMinor: rows.reduce((sum, row) => sum + row.revenueMinor, 0),
    },
  };
}

export type TrackedSchool = Awaited<ReturnType<typeof schoolTracker>>["rows"][number];
