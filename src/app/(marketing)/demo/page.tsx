import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheckIcon, SparklesIcon, TimerIcon } from "lucide-react";

import { DemoStarter } from "@/features/demo/forms";
import { ComparisonTable } from "@/features/plans/plan-display";
import { campusAllowanceText } from "@/lib/plan-catalog";
import { getPublicPlans } from "@/server/platform/marketing";
import { DEMO_ROLE_INFO, DEMO_ROLES } from "@/server/demo/config";

export const metadata: Metadata = {
  title: "Live Demo",
  description: "Explore the real SchoolOS app with a fictional demo school — no registration needed.",
};

/**
 * The Live Demo's front door. Choosing a role makes a private sample school
 * for this visitor and signs them in as that person — the real app, with
 * fictional data, for two hours.
 */
export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const plans = await getPublicPlans().catch(() => []);
  return (
    <main className="flex-1">
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-primary mb-3 text-sm font-semibold tracking-wide uppercase">Live Demo</p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">Try the real SchoolOS — with a sample school</h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg text-pretty">
          Pick who you want to be. We set up <strong className="text-foreground">Green Valley Demo School</strong> just for you — 36 students, 6 teachers, a month of attendance, exams, fees and notices — and open the same app schools use.
        </p>
        <ul className="text-muted-foreground mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <li className="flex items-start gap-2">
            <SparklesIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            Every name and record is fictional. Your changes stay in your own sample school.
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            No email is sent and no money is charged. Receipts are marked as samples.
          </li>
          <li className="flex items-start gap-2">
            <TimerIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            Lasts two hours, then it is deleted. Start over or switch role any time.
          </li>
        </ul>

        <div className="mt-10">
          <DemoStarter plans={plans.map((plan) => ({ slug: plan.slug, name: plan.name, summary: campusAllowanceText(plan) }))} roles={DEMO_ROLES.map((role) => ({ role, ...DEMO_ROLE_INFO[role] }))} />
        </div>

        {plans.length ? (
          <section id="compare" className="mt-14 scroll-mt-24" aria-labelledby="compare-heading">
            <h2 id="compare-heading" className="text-2xl font-bold tracking-tight">Compare the plans</h2>
            <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
              Switching plan in the demo switches the sample school&apos;s modules to exactly that plan&apos;s — menus and pages follow, and a module outside the plan shows why it is not available. The demo has one campus, so multi-campus features (more campuses, the organization dashboard) are described here rather than interactive. Custom feature requests, campus requests and plan changes are turned off in the demo.
            </p>
            <div className="mt-6">
              <ComparisonTable plans={plans} />
            </div>
          </section>
        ) : null}

        <p className="text-muted-foreground mt-10 text-sm">
          Ready for your own school?{" "}
          <Link href="/register" className="text-primary font-medium hover:underline">
            Register your school
          </Link>{" "}
          — SchoolOS reviews every registration before it goes live.
        </p>
      </section>
    </main>
  );
}
