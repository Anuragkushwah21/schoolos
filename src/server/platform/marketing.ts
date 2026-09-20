import "server-only";

import { prisma } from "@/server/db/prisma";

/**
 * Public data for the SaaS marketing site. Nothing here is school-owned; it is
 * the platform's own catalogue, readable by anyone.
 */

/**
 * Offers currently in their display window. Expired offers drop off on their
 * own — nobody has to remember to unpublish them.
 */
export async function getLiveOffers(now: Date = new Date()) {
  return prisma.platformOffer.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: [{ sortOrder: "asc" }, { startsAt: "desc" }],
    select: {
      id: true,
      title: true,
      description: true,
      priceLabel: true,
      ctaLabel: true,
      ctaHref: true,
      endsAt: true,
    },
  });
}

export async function getPublicPlans() {
  return prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { priceMinor: "asc" },
    select: {
      id: true,
      tier: true,
      name: true,
      description: true,
      priceMinor: true,
      currency: true,
      maxStudents: true,
      maxTeachers: true,
      maxAdmins: true,
      storageMb: true,
    },
  });
}

export type PublicPlan = Awaited<ReturnType<typeof getPublicPlans>>[number];
export type LiveOffer = Awaited<ReturnType<typeof getLiveOffers>>[number];
