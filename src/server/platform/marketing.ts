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

/**
 * What the homepage needs, and what it does when the database is unreachable.
 *
 * Offers and prices are the only database-backed parts of that page; the rest
 * is what the product is and how to sign up. A blip in the database should not
 * take the front door down with it, so the catalogue degrades to empty — the
 * pricing and offer sections simply do not render — and the failure is logged
 * rather than swallowed.
 *
 * This is deliberately the only place that does this. Anywhere someone is
 * *working* — every signed-in screen — an unreachable database has to be an
 * error, because quietly showing them no students would be worse than saying
 * something broke.
 */
export async function getHomepageCatalogue(): Promise<{
  offers: LiveOffer[];
  plans: PublicPlan[];
  degraded: boolean;
}> {
  try {
    const [offers, plans] = await Promise.all([getLiveOffers(), getPublicPlans()]);
    return { offers, plans, degraded: false };
  } catch (error) {
    console.error(
      "[marketing] could not read offers and plans; rendering the homepage without them",
      error,
    );
    return { offers: [], plans: [], degraded: true };
  }
}
