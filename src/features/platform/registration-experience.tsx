"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ComparisonTable, type DisplayPlan, PlanCard } from "@/features/plans/plan-display";
import { formatMoney } from "@/lib/format";
import { campusAllowanceText, periodLabel } from "@/lib/plan-catalog";

import { RegisterForm } from "./register-form";

/**
 * Registration with the plans beside it: compare, choose, and fill in the
 * form — on one page, so changing your mind about the plan never loses what
 * you typed. The choice is kept in the address (`?plan=`) so a reload or the
 * back button returns to it.
 */
export function RegistrationExperience({ plans, initialPlan }: { plans: DisplayPlan[]; initialPlan: string }) {
  const [plan, setPlan] = useState(initialPlan);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (plan) url.searchParams.set("plan", plan);
    else url.searchParams.delete("plan");
    window.history.replaceState(null, "", url);
  }, [plan]);

  const choose = (slug: string) => {
    setPlan(slug);
    document.getElementById("register-form")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="flex flex-col gap-12">
      {plans.length ? (
        <section aria-labelledby="plans-heading" className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 id="plans-heading" className="text-2xl font-bold tracking-tight">Choose a plan</h2>
            <p className="text-muted-foreground">One subscription covers your whole organization. Every plan runs a complete school; higher plans add campuses and modules.</p>
          </div>
          <div className="grid items-stretch gap-6 lg:grid-cols-3">
            {plans.map((row, index) => (
              <PlanCard key={row.id} plan={row} featured={row.slug === plan || (!plan && plans.length >= 3 && index === 1)}>
                <Button type="button" className="w-full" variant={row.slug === plan ? "default" : "outline"} aria-pressed={row.slug === plan} onClick={() => choose(row.slug)}>
                  {row.slug === plan ? `${row.name} selected` : `Choose ${row.name}`}
                </Button>
              </PlanCard>
            ))}
          </div>
          <details id="compare" className="group scroll-mt-24">
            <summary className="text-primary cursor-pointer text-sm font-semibold">Compare all features</summary>
            <div className="mt-4">
              <ComparisonTable plans={plans} />
            </div>
          </details>
        </section>
      ) : (
        <p className="bg-muted/50 rounded-2xl border p-6 text-sm">Plans are being updated. You can still register — SchoolOS will agree a plan with you when reviewing your school.</p>
      )}

      <section id="register-form" aria-labelledby="form-heading" className="bg-card ring-foreground/10 relative scroll-mt-24 rounded-2xl p-6 shadow-sm ring-1 sm:p-8">
        <h2 id="form-heading" className="mb-6 text-xl font-bold">Your school&apos;s details</h2>
        <RegisterForm
          plans={plans.map((row) => ({ slug: row.slug, name: row.name, price: row.priceOnRequest ? "Price on request" : `${formatMoney(row.priceMinor, row.currency)} / ${periodLabel(row.billingPeriod)}`, campuses: campusAllowanceText(row) }))}
          plan={plan}
          onPlanChange={setPlan}
        />
      </section>
    </div>
  );
}
