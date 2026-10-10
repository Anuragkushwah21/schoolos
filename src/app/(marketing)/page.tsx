import type { Metadata } from "next";

import {
  ClosingCta,
  Faq,
  Features,
  Hero,
  MultiCampus,
  OffersSection,
  Pricing,
  Problems,
  Roles,
  Security,
  Solutions,
  Steps,
} from "@/features/marketing/sections";
import { getHomepageCatalogue } from "@/server/platform/marketing";

export const metadata: Metadata = {
  title: { absolute: "SchoolOS — Your Entire School. One Smart Platform." },
  description:
    "Students, attendance, exams and report cards, fees and receipts, timetable, notices and a parent portal for schools from Nursery to Class 12. Try the Live Demo.",
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
  const { offers, upcoming, plans } = await getHomepageCatalogue();

  return (
    <main className="flex flex-1 flex-col">
      <Hero offer={offers[0]} />
      <Problems />
      <Solutions />
      <Features />
      <Roles />
      <MultiCampus />
      <Security />
      <Steps />
      <OffersSection offers={offers} upcoming={upcoming} />
      <Pricing plans={plans} />
      <Faq />
      <ClosingCta />
    </main>
  );
}
