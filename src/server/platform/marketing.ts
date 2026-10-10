import "server-only";

import { type BillingPeriodKey, cleanFeatures } from "@/lib/plan-catalog";
import { cleanModules } from "@/lib/school-modules";
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

/** How far ahead a scheduled offer is announced as "coming soon". */
export const UPCOMING_OFFER_DAYS = 45;

/**
 * Offers that are switched on and start soon, so a school can see what is
 * coming — the Diwali offer a week before Diwali, not only on the day.
 */
export async function getUpcomingOffers(now: Date = new Date()) {
  return prisma.platformOffer.findMany({
    where: {
      isActive: true,
      startsAt: { gt: now, lte: new Date(now.getTime() + UPCOMING_OFFER_DAYS * 86_400_000) },
    },
    orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      priceLabel: true,
      ctaLabel: true,
      ctaHref: true,
      startsAt: true,
      endsAt: true,
    },
  });
}

/**
 * The published plans, in display order: the one catalogue the homepage,
 * registration, the Live Demo and the Upgrade Plan page all read. Drafts,
 * archived and deactivated plans never appear; a plan's unpublished edits
 * (its `draft`) are never read here.
 */
export async function getPublicPlans() {
  const rows = await prisma.plan.findMany({
    where: { isActive: true, status: "PUBLISHED" },
    orderBy: [{ displayOrder: "asc" }, { priceMinor: "asc" }],
    select: PUBLIC_PLAN_SELECT,
  });
  return rows.map(presentPublicPlan);
}

export const PUBLIC_PLAN_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  highlights: true,
  displayOrder: true,
  priceMinor: true,
  priceOnRequest: true,
  billingPeriod: true,
  currency: true,
  maxStudents: true,
  maxTeachers: true,
  maxAdmins: true,
  storageMb: true,
  campusLimit: true,
  extraCampusAllowed: true,
  extraCampusPriceMinor: true,
  extraCampusPeriod: true,
  maxCampuses: true,
  optionalModules: true,
  features: true,
} as const;

type PublicPlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  highlights: string[];
  displayOrder: number;
  priceMinor: number;
  priceOnRequest: boolean;
  billingPeriod: BillingPeriodKey;
  currency: string;
  maxStudents: number | null;
  maxTeachers: number | null;
  maxAdmins: number | null;
  storageMb: number | null;
  campusLimit: number;
  extraCampusAllowed: boolean;
  extraCampusPriceMinor: number | null;
  extraCampusPeriod: BillingPeriodKey;
  maxCampuses: number | null;
  optionalModules: string[];
  features: string[];
};

export function presentPublicPlan(row: PublicPlanRow) {
  return { ...row, optionalModules: cleanModules(row.optionalModules), features: cleanFeatures(row.features) };
}

export type PublicPlan = Awaited<ReturnType<typeof getPublicPlans>>[number];
export type LiveOffer = Awaited<ReturnType<typeof getLiveOffers>>[number];
export type UpcomingOffer = Awaited<ReturnType<typeof getUpcomingOffers>>[number];

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
  upcoming: UpcomingOffer[];
  plans: PublicPlan[];
  degraded: boolean;
}> {
  try {
    const [offers, upcoming, plans] = await Promise.all([
      getLiveOffers(),
      getUpcomingOffers(),
      getPublicPlans(),
    ]);
    return { offers, upcoming, plans, degraded: false };
  } catch (error) {
    console.error(
      "[marketing] could not read offers and plans; rendering the homepage without them",
      error,
    );
    return { offers: [], upcoming: [], plans: [], degraded: true };
  }
}
