import type { Metadata } from "next";

import {
  ClosingCta,
  Faq,
  Features,
  Hero,
  OfferBand,
  Pricing,
  Roles,
  Security,
  Steps,
} from "@/features/marketing/sections";
import { getHomepageCatalogue } from "@/server/platform/marketing";

export const metadata: Metadata = {
  title: { absolute: "SchoolOS — School management for every school you run" },
  description:
    "Admissions, students, teachers, timetable, attendance and a public website for schools from Nursery to Class 12, with each school's data kept private.",
};

/**
 * Rendered per request, not at build time.
 *
 * The offers and prices on this page are live rows a Super Admin edits, so a
 * copy baked at build time would be stale the moment they change one. It also
 * keeps `next build` from needing the production database to be reachable,
 * which it otherwise would be for this one page.
 */
export const dynamic = "force-dynamic";

/**
 * SaaS marketing homepage.
 *
 * This is the platform's own front door, not a school website — school sites
 * live at `/schools/[slug]`. Offers and plans are read live, so a Super Admin's
 * change to either appears here without a deploy, and an offer past its end
 * date disappears on its own.
 */
export default async function HomePage() {
  // Degrades to an empty catalogue rather than a 500 — see the note on
  // `getHomepageCatalogue`.
  const { offers, plans } = await getHomepageCatalogue();

  return (
    <main className="flex flex-1 flex-col">
      <Hero offer={offers[0]} />
      <OfferBand offers={offers} />
      <Features />
      <Roles />
      <Steps />
      <Security />
      <Pricing plans={plans} />
      <Faq />
      <ClosingCta />
    </main>
  );
}
