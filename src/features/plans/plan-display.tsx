import { CheckIcon, MinusIcon } from "lucide-react";

import { formatMoney } from "@/lib/format";
import { type BillingPeriodKey, PLAN_FEATURES, campusAllowanceText, catalogueRows, periodLabel, quote } from "@/lib/plan-catalog";
import { cn } from "@/lib/utils";

/**
 * Plan presentation shared by the homepage, registration, the Live Demo, the
 * Plan & billing page and the Plan Builder's preview — so every screen shows
 * the same published configuration the same way. Server-renderable.
 */

export type DisplayPlan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  highlights: string[];
  priceMinor: number;
  priceOnRequest: boolean;
  billingPeriod: BillingPeriodKey;
  currency?: string;
  campusLimit: number;
  extraCampusAllowed: boolean;
  extraCampusPriceMinor: number | null;
  extraCampusPeriod: BillingPeriodKey;
  maxCampuses: number | null;
  optionalModules: readonly string[];
  features: readonly string[];
  maxStudents?: number | null;
  maxTeachers?: number | null;
};

/** "₹15,000 / year", or "Price on request" — never an invented number. */
export function PlanPrice({ plan, className }: { plan: Pick<DisplayPlan, "priceMinor" | "priceOnRequest" | "billingPeriod" | "currency">; className?: string }) {
  if (plan.priceOnRequest) return <span className={cn("text-2xl font-extrabold tracking-tight", className)}>Price on request</span>;
  return (
    <span className={cn("flex items-baseline gap-1", className)}>
      <span className="text-3xl font-extrabold tracking-tight tabular-nums">{formatMoney(plan.priceMinor, plan.currency)}</span>
      <span className="text-muted-foreground text-sm">{`/ ${periodLabel(plan.billingPeriod)}`}</span>
    </span>
  );
}

export function extraCampusText(plan: Pick<DisplayPlan, "extraCampusAllowed" | "extraCampusPriceMinor" | "extraCampusPeriod" | "maxCampuses" | "currency">): string {
  if (!plan.extraCampusAllowed) return "No extra campuses on this plan — upgrade for more.";
  const price = plan.extraCampusPriceMinor ? `${formatMoney(plan.extraCampusPriceMinor, plan.currency)} per extra campus per ${periodLabel(plan.extraCampusPeriod)}` : "Extra campuses at no extra charge";
  return `${price}${plan.maxCampuses !== null ? `, up to ${plan.maxCampuses} campuses in all` : ""}. Each needs SchoolOS approval.`;
}

/** The full breakdown for `campuses` campuses: plan fee once, plus extras. */
export function QuoteBreakdown({ plan, campuses, className }: { plan: DisplayPlan; campuses: number; className?: string }) {
  const q = quote(plan, campuses);
  const money = (minor: number) => formatMoney(minor, plan.currency);
  return (
    <dl className={cn("grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm", className)}>
      <dt>{`${plan.name} plan (includes ${q.includedCampuses} campus${q.includedCampuses === 1 ? "" : "es"})`}</dt>
      <dd className="text-right tabular-nums">{q.onRequest ? "on request" : `${money(q.planFeeMinor!)} / ${periodLabel(q.billingPeriod)}`}</dd>
      {q.extraCampuses ? (
        <>
          <dt>{`Extra campuses × ${q.extraCampuses}`}</dt>
          <dd className="text-right tabular-nums">{q.extraEachMinor === null ? "not allowed" : `${money(q.extraTotalMinor!)} / ${periodLabel(q.extraPeriod)}`}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground col-span-2 pt-1 text-xs">Billed by SchoolOS after approval. SchoolOS does not take online payments; nothing is charged by sending a request.</dt>
    </dl>
  );
}

/** A public plan card. `action` renders the plan's call to action. */
export function PlanCard({ plan, featured = false, children }: { plan: DisplayPlan; featured?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("bg-card shadow-card relative flex flex-col gap-5 rounded-3xl p-6 ring-1", featured ? "ring-primary ring-2" : "ring-border")}>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        {plan.description ? <p className="text-muted-foreground text-sm">{plan.description}</p> : null}
      </div>
      <PlanPrice plan={plan} />
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex gap-2">
          <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="font-medium">{campusAllowanceText(plan)}</span>
        </li>
        {plan.highlights.map((point) => (
          <li key={point} className="flex gap-2">
            <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            {point}
          </li>
        ))}
        {plan.maxStudents !== undefined ? (
          <li className="flex gap-2">
            <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            {plan.maxStudents === null ? "Unlimited students" : `Up to ${plan.maxStudents.toLocaleString("en-IN")} students per campus`}
          </li>
        ) : null}
      </ul>
      <p className="text-muted-foreground text-xs">{extraCampusText(plan)}</p>
      {children ? <div className="mt-auto">{children}</div> : null}
    </div>
  );
}

function Mark({ on, label }: { on: boolean; label: string }) {
  return on ? <CheckIcon className="text-success-strong mx-auto size-4" aria-label={`${label}: included`} /> : <MinusIcon className="text-muted-foreground mx-auto size-4" aria-label={`${label}: not included`} />;
}

/** Module-by-module comparison of the given plans, grouped by category. */
export function ComparisonTable({ plans, caption = "Compare all features" }: { plans: DisplayPlan[]; caption?: string }) {
  if (!plans.length) return null;
  return (
    <div className="bg-card overflow-x-auto rounded-2xl border">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="px-4 py-3 text-left font-semibold">
              Feature
            </th>
            {plans.map((plan) => (
              <th key={plan.id} scope="col" className="px-4 py-3 text-center font-semibold">
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <th scope="row" className="px-4 py-2.5 text-left font-medium">
              Campuses included
            </th>
            {plans.map((plan) => (
              <td key={plan.id} className="px-4 py-2.5 text-center tabular-nums">
                {plan.campusLimit}
              </td>
            ))}
          </tr>
          <tr className="border-b">
            <th scope="row" className="px-4 py-2.5 text-left font-medium">
              Extra campuses
            </th>
            {plans.map((plan) => (
              <td key={plan.id} className="text-muted-foreground px-4 py-2.5 text-center text-xs">
                {plan.extraCampusAllowed ? (plan.extraCampusPriceMinor ? `${formatMoney(plan.extraCampusPriceMinor, plan.currency)} / ${periodLabel(plan.extraCampusPeriod)} each` : "Allowed") : "—"}
              </td>
            ))}
          </tr>
          {PLAN_FEATURES.map((feature) => (
            <tr key={feature.key} className="border-b">
              <th scope="row" className="px-4 py-2.5 text-left font-medium" title={feature.hint}>
                {feature.label}
              </th>
              {plans.map((plan) => (
                <td key={plan.id} className="px-4 py-2.5">
                  <Mark on={plan.features.includes(feature.key)} label={feature.label} />
                </td>
              ))}
            </tr>
          ))}
          {catalogueRows().map((group) => (
            <GroupRows key={group.title} title={group.title} rows={group.rows} plans={plans} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ title, rows, plans }: { title: string; rows: ReturnType<typeof catalogueRows>[number]["rows"]; plans: DisplayPlan[] }) {
  return (
    <>
      <tr className="bg-muted/50">
        <th scope="colgroup" colSpan={plans.length + 1} className="px-4 py-2 text-left text-xs font-semibold tracking-wide uppercase">
          {title}
        </th>
      </tr>
      {rows.map((row) => (
        <tr key={row.key} className="border-b last:border-0">
          <th scope="row" className="px-4 py-2.5 text-left font-normal">
            <span className="block">{row.label}</span>
            <span className="text-muted-foreground block text-xs">{row.hint}</span>
          </th>
          {plans.map((plan) => (
            <td key={plan.id} className="px-4 py-2.5">
              <Mark on={row.core || plan.optionalModules.includes(row.key)} label={row.label} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
