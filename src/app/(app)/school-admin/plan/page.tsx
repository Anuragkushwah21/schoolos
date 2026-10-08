import type { Metadata } from "next";
import { SparklesIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelPlanChangeAction } from "@/features/campuses/plan-actions";
import { RequestPlanForm } from "@/features/campuses/plan-forms";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { moduleLabel } from "@/lib/school-modules";
import { describeLimits, roleLabel } from "@/lib/school-roles";
import { cn } from "@/lib/utils";
import { requireTenant } from "@/server/auth/current-user";
import { planOverview } from "@/server/platform/plan-requests";

export const metadata: Metadata = { title: "Upgrade plan" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Waiting for SchoolOS", tone: "warning" },
  APPROVED: { label: "Approved", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "negative" },
  CANCELLED: { label: "Withdrawn", tone: "neutral" },
};

/**
 * Upgrade Plan: the current plan and campus entitlement, the plans on offer,
 * and requests. Online payment is not part of SchoolOS yet — choosing a plan
 * sends a request, and nothing changes until SchoolOS approves it.
 */
export default async function UpgradePlanPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const data = await planOverview(ctx);
  const current = data.current;
  const rank = (priceMinor: number) => (current ? priceMinor - current.priceMinor : priceMinor);

  return (
    <>
      <PageHeader icon={SparklesIcon} tone="purple" title="Upgrade Plan" description="See what each plan includes and ask SchoolOS to move your school to another plan. Online payment is not available yet: SchoolOS confirms every change, and your plan stays the same until then." />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{current ? `Current plan: ${current.name}` : "No plan yet"}</CardTitle>
            <CardDescription>{current ? `${formatMoney(current.priceMinor, current.currency)} / year` : "SchoolOS has not set a plan for your school."}</CardDescription>
          </CardHeader>
          {current ? (
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <p>{`Modules: ${current.modules.map(moduleLabel).join(", ") || "core only"}`}</p>
              <p>{`Roles: ${current.roles.map(roleLabel).join(", ") || "core only"}`}</p>
              <p>{`Limits: ${describeLimits(current.limits)}`}</p>
            </CardContent>
          ) : null}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Campus entitlement</CardTitle>
            <CardDescription>{`${data.campus.used} of ${data.campus.limit} campus${data.campus.limit === 1 ? "" : "es"} in use${data.campus.overridden ? " (set for your organization by SchoolOS)" : ""}.`}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">{data.campus.limit > 1 ? "Multi-campus is on: request another school/campus from My Schools." : "Single school. A plan with more campuses lets SchoolOS open another school for you — you can send a campus request at any time."}</CardContent>
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

      <h2 className="mb-3 text-base font-semibold">Plans</h2>
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        {data.plans.map((plan) => {
          const isCurrent = current?.id === plan.id;
          const higher = rank(plan.priceMinor) > 0;
          return (
            <Card key={plan.id} className={cn(isCurrent && "ring-primary ring-2")}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {plan.name}
                  {isCurrent ? <StatusBadge status="CURRENT" label="Your plan" tone="info" /> : higher ? <StatusBadge status="UP" label="Upgrade" tone="positive" /> : null}
                </CardTitle>
                <CardDescription>{`${formatMoney(plan.priceMinor, plan.currency)} / year · ${plan.campusLimit > 1 ? `up to ${plan.campusLimit} campuses` : "1 campus"}`}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {plan.description ? <p className="text-muted-foreground">{plan.description}</p> : null}
                <p>{`Modules: ${plan.modules.map(moduleLabel).join(", ") || "core only"}`}</p>
                <p>{`Roles: ${plan.roles.map(roleLabel).join(", ") || "core only"}`}</p>
                <p>{`Limits: ${describeLimits(plan.limits)}`}</p>
                {!isCurrent && !data.open ? <RequestPlanForm planId={plan.id} planName={plan.name} /> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

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
