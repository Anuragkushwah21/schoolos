import type { Metadata } from "next";
import Link from "next/link";
import { SparklesIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { PlanDecisionForms } from "@/features/campuses/plan-forms";
import { formatDate } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listPlanChangeRequests } from "@/server/platform/plan-requests";

export const metadata: Metadata = { title: "Plan requests" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "negative" },
  CANCELLED: { label: "Withdrawn", tone: "neutral" },
};
const VIEWS = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

/** Schools asking for another plan. Approving changes the school's subscription now; there is no online payment yet. */
export default async function PlanRequestsPage(props: PageProps<"/super-admin/plan-requests">) {
  const user = await requireSuperAdmin();
  const asked = param((await props.searchParams).status);
  const view = (VIEWS as readonly string[]).includes(asked ?? "") ? (asked as (typeof VIEWS)[number]) : null;
  const rows = await listPlanChangeRequests(user, view);
  return (
    <>
      <PageHeader icon={SparklesIcon} tone="purple" title="Plan requests" description="Schools asking to change plan. Approving moves the school to the plan now (modules and roles follow unless adjusted for the school). Payment is arranged outside SchoolOS." />
      <ViewTabs
        label="Status"
        tabs={[{ href: "/super-admin/plan-requests", label: "All", active: view === null }, ...VIEWS.map((key) => ({ href: `/super-admin/plan-requests?status=${key}`, label: STATUS[key]!.label, active: view === key }))]}
      />
      {rows.length ? (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 pt-5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="font-semibold hover:underline" href={`/super-admin/schools/${row.school.id}`}>
                      {row.school.name}
                    </Link>
                    <StatusBadge status={row.status} label={STATUS[row.status]!.label} tone={STATUS[row.status]!.tone} />
                    <span className="text-muted-foreground ml-auto font-mono text-xs">{row.id.slice(-8).toUpperCase()}</span>
                  </div>
                  <p>{`${row.currentPlan?.name ?? "No plan"} → ${row.requestedPlan.name} (${row.requestedPlan.campusLimit > 1 ? `up to ${row.requestedPlan.campusLimit} campuses` : "1 campus"})`}</p>
                  <p className="text-muted-foreground">{`${row.school.organization?.name ?? ""}${row.requestedBy ? ` · ${row.requestedBy.firstName} ${row.requestedBy.lastName} (${row.requestedBy.email})` : ""} · ${formatDate(row.createdAt)}`}</p>
                  {row.note ? <p className="whitespace-pre-line">{row.note}</p> : null}
                  {row.rejectionReason ? <p className="text-danger-strong">{`Reason: ${row.rejectionReason}`}</p> : null}
                  {row.reviewNote ? <p className="text-muted-foreground">{row.reviewNote}</p> : null}
                  {row.status === "PENDING" ? <PlanDecisionForms requestId={row.id} /> : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={SparklesIcon} title="No plan requests">Requests appear here when a school asks to change plan.</EmptyState>
      )}
    </>
  );
}
