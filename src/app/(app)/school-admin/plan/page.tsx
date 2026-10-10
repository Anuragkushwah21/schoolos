import type { Metadata } from "next";
import Link from "next/link";
import { SparklesIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelPlanChangeAction, requestPlanChangeAction } from "@/features/campuses/plan-actions";
import { CampusModulesForm } from "@/features/campuses/plan-forms";
import { ComparisonTable, PlanPrice, QuoteBreakdown, extraCampusText } from "@/features/plans/plan-display";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { campusAllowanceText, featureLabel, periodLabel, quote } from "@/lib/plan-catalog";
import { OPTIONAL_MODULES, moduleLabel } from "@/lib/school-modules";
import { describeLimits, roleLabel } from "@/lib/school-roles";
import { cn } from "@/lib/utils";
import { requireTenant } from "@/server/auth/current-user";
import { campusModulesOverview } from "@/server/campuses/modules";
import { planOverview } from "@/server/platform/plan-requests";

export const metadata: Metadata = { title: "Plan & billing" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Waiting for SchoolOS", tone: "warning" },
  APPROVED: { label: "Approved", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "negative" },
  CANCELLED: { label: "Withdrawn", tone: "neutral" },
};

const LABELS = Object.fromEntries(OPTIONAL_MODULES.map((module) => [module.key, { label: module.label, hint: module.hint }]));

/**
 * Plan & billing: the organization's plan, campus allowance and price
 * breakdown; the published plans to move to; and which eligible modules each
 * campus has switched on. Online payment is not part of SchoolOS — choosing
 * a plan sends a request, and nothing changes (or is charged) until SchoolOS
 * approves it.
 */
export default async function PlanPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [data, modules] = await Promise.all([planOverview(ctx), campusModulesOverview(ctx)]);
  const current = data.current;
  const campuses = data.campus.used;

  return (
    <>
      <PageHeader icon={SparklesIcon} tone="purple" title="Plan & billing" description="Your plan, what it costs for your campuses, and which modules each campus uses. SchoolOS does not take online payments: every change is a request that SchoolOS confirms." />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{current ? `Current plan: ${current.name}` : "No plan yet"}</CardTitle>
            <CardDescription>{current ? campusAllowanceText(current) : "SchoolOS has not set a plan for your school yet."}</CardDescription>
          </CardHeader>
          {current ? (
            <CardContent className="flex flex-col gap-3 text-sm">
              <QuoteBreakdown plan={current} campuses={campuses} />
              <p>{`Modules in the plan: ${current.optionalModules.map(moduleLabel).join(", ") || "core only"}`}</p>
              {current.features.length ? <p>{`Also includes: ${current.features.map(featureLabel).join(", ")}`}</p> : null}
              <p className="text-muted-foreground text-xs">{`Roles: ${current.roles.map(roleLabel).join(", ") || "core only"} · Limits: ${describeLimits(current.limits)}`}</p>
            </CardContent>
          ) : null}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Campuses</CardTitle>
            <CardDescription>{`${campuses} campus${campuses === 1 ? "" : "es"} · ${data.campus.included} included in your plan${data.campus.limit === null ? "" : ` · up to ${data.campus.limit}`}${data.campus.overridden ? " (set for your organization by SchoolOS)" : ""}.`}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {current ? <p>{extraCampusText(current)}</p> : null}
            <p>
              <Link href="/school-admin/campuses/request" className="text-primary font-medium hover:underline">
                Request another campus
              </Link>{" "}
              — the price is shown before you send it.
            </p>
          </CardContent>
        </Card>
      </div>

      {data.open ? (
        <div className="bg-warning-soft text-warning-strong mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
          <span>{`Your request to move to ${data.open.requestedPlan.name} (sent ${formatDate(data.open.createdAt)}) is waiting for SchoolOS. Nothing changes until it is approved.`}</span>
          <ActionButton action={cancelPlanChangeAction} fields={{ requestId: data.open.id }} variant="outline" confirm={{ title: "Withdraw this plan request?", description: "You can choose a plan again afterwards." }}>
            Withdraw
          </ActionButton>
        </div>
      ) : null}

      <h2 className="mb-3 text-base font-semibold">Modules by campus</h2>
      <p className="text-muted-foreground mb-3 text-sm">{`Your ${modules.planName ?? ""} plan makes these modules available. Switch on only what each campus needs — an upgrade never switches anything on by itself.`.replace("  ", " ")}</p>
      <div className="mb-8 grid gap-4 xl:grid-cols-2">
        {modules.campuses.map((campus) => (
          <Card key={campus.id}>
            <CardHeader>
              <CardTitle>{campus.name}</CardTitle>
              <CardDescription>{campus.city ?? ""}</CardDescription>
            </CardHeader>
            <CardContent>
              <CampusModulesForm schoolId={campus.id} campusName={campus.name} eligible={modules.eligible} enabled={campus.enabled} labels={LABELS} />
            </CardContent>
          </Card>
        ))}
      </div>

      {modules.notInPlan.length ? (
        <div className="bg-muted/40 mb-8 rounded-xl border p-4 text-sm">
          <p className="font-semibold">Not in your plan</p>
          <ul className="mt-2 flex flex-col gap-1">
            {modules.notInPlan.map((row) => (
              <li key={row.key}>{`${row.label}${row.plans.length ? ` — comes with ${row.plans.join(" and ")}` : " — ask SchoolOS"}`}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2 className="mb-3 text-base font-semibold">Plans</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {data.plans.map((plan) => {
          const isCurrent = current?.id === plan.id;
          const q = quote(plan, campuses);
          const breakdown = q.onRequest
            ? "The price for this plan is agreed with SchoolOS."
            : `${plan.name}: ${formatMoney(q.planFeeMinor!)} / ${periodLabel(q.billingPeriod)} for ${q.includedCampuses} campus${q.includedCampuses === 1 ? "" : "es"}${q.extraCampuses ? (q.extraEachMinor === null ? `. You run ${campuses} campuses but this plan allows ${plan.campusLimit} — SchoolOS will discuss it with you.` : ` + ${q.extraCampuses} extra × ${formatMoney(q.extraEachMinor)} = ${formatMoney(q.extraTotalMinor!)} / ${periodLabel(q.extraPeriod)}`) : ""}. It replaces your current plan fee.`;
          return (
            <Card key={plan.id} className={cn(isCurrent && "ring-primary ring-2")}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {plan.name}
                  {isCurrent ? <StatusBadge status="CURRENT" label="Your plan" tone="info" /> : null}
                </CardTitle>
                <CardDescription>{campusAllowanceText(plan)}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <PlanPrice plan={plan} />
                {plan.description ? <p className="text-muted-foreground">{plan.description}</p> : null}
                <QuoteBreakdown plan={plan} campuses={campuses} />
                {!isCurrent && !data.open ? (
                  <ActionButton
                    action={requestPlanChangeAction}
                    fields={{ planId: plan.id, note: "" }}
                    size="default"
                    confirm={{ title: `Request the ${plan.name} plan?`, description: `${breakdown} Nothing is charged now: SchoolOS confirms the change and bills you afterwards. Your modules stay as they are — switch on newly available ones yourself after approval.`, confirmLabel: "Send request" }}
                  >
                    {`Request ${plan.name}`}
                  </ActionButton>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <details className="mb-8">
        <summary className="text-primary cursor-pointer text-sm font-semibold">Compare all features</summary>
        <div className="mt-4">
          <ComparisonTable plans={data.plans} />
        </div>
      </details>

      <h2 className="mb-3 text-base font-semibold">Plan requests</h2>
      {data.requests.length ? (
        <ul className="flex flex-col gap-2">
          {data.requests.map((request) => (
            <li key={request.id} className="bg-card flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm">
              <span className="font-mono text-xs">{request.id.slice(-8).toUpperCase()}</span>
              <span className="font-medium">{`${request.currentPlan?.name ?? "No plan"} → ${request.requestedPlan.name}`}</span>
              <span className="text-muted-foreground">{formatDate(request.createdAt)}</span>
              <StatusBadge status={request.status} label={STATUS[request.status]!.label} tone={STATUS[request.status]!.tone} />
              {request.rejectionReason ? <span className="text-danger-strong w-full text-xs">{`Reason: ${request.rejectionReason}`}</span> : null}
              {request.reviewNote ? <span className="text-muted-foreground w-full text-xs">{`SchoolOS: ${request.reviewNote}`}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No plan requests yet.</p>
      )}
    </>
  );
}
