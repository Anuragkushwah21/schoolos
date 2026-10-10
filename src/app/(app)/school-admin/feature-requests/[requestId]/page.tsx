import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LightbulbIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureReplyForm } from "@/features/feature-requests/forms";
import { formatDateTime } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { FEATURE_STATUS_LABELS, myFeatureRequest } from "@/server/platform/feature-requests";

export const metadata: Metadata = { title: "Feature request" };

const SCOPE: Record<string, string> = { CUSTOMER_SPECIFIC: "Made for your organization", OPTIONAL_MODULE: "Optional module", STANDARD_FEATURE: "Standard feature", PREMIUM_ADDON: "Paid add-on" };

export default async function FeatureRequestPage(props: PageProps<"/school-admin/feature-requests/[requestId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { requestId } = await props.params;
  const row = await myFeatureRequest(ctx, requestId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const closed = row.status === "RELEASED" || row.status === "DECLINED";
  return (
    <>
      <PageHeader icon={LightbulbIcon} tone="amber" title={row.title} description={`Request ${row.id.slice(-8).toUpperCase()} · ${row.school?.name ?? "All campuses"}`} actions={<StatusBadge status={row.status} label={FEATURE_STATUS_LABELS[row.status]} />} />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What you asked for</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="whitespace-pre-line">{`Problem: ${row.problem}`}</p>
            <p className="whitespace-pre-line">{row.description}</p>
            {row.expectedOutcome ? <p className="whitespace-pre-line">{`Expected outcome: ${row.expectedOutcome}`}</p> : null}
            {row.examples ? <p className="text-muted-foreground whitespace-pre-line">{`Examples: ${row.examples}`}</p> : null}
            <dl className="bg-muted/40 grid grid-cols-2 gap-2 rounded-xl p-3">
              <dt className="text-muted-foreground">Timeline</dt>
              <dd>{row.estimatedTimeline ?? "Not estimated yet"}</dd>
              <dt className="text-muted-foreground">Development cost</dt>
              <dd>{row.estimatedCostMinor === null ? "Not estimated yet" : `${formatMoney(row.estimatedCostMinor)}${row.costAgreed ? " (agreed)" : " (estimate)"}`}</dd>
              {row.releaseScope ? (
                <>
                  <dt className="text-muted-foreground">Released as</dt>
                  <dd>{SCOPE[row.releaseScope]}</dd>
                </>
              ) : null}
            </dl>
            <p className="text-muted-foreground text-xs">Nothing is charged by SchoolOS online. Any cost is agreed with you before work starts.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ol className="flex flex-col gap-3 text-sm">
              {row.events.map((event) => (
                <li key={event.id} className="border-l-2 pl-3">
                  <p className="text-muted-foreground text-xs">{`${formatDateTime(event.createdAt)} · ${event.actor ? (event.actor.role === "SUPER_ADMIN" ? "SchoolOS" : `${event.actor.firstName} ${event.actor.lastName}`) : "—"}${event.toStatus ? ` · ${FEATURE_STATUS_LABELS[event.toStatus]}` : ""}`}</p>
                  {event.body ? <p className="whitespace-pre-line">{event.body}</p> : null}
                </li>
              ))}
            </ol>
            {!closed ? <FeatureReplyForm requestId={row.id} waiting={row.status === "NEEDS_INFO"} /> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
