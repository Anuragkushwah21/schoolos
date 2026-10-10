import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LightbulbIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureDecisionForm } from "@/features/feature-requests/forms";
import { formatDateTime } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { moduleLabel } from "@/lib/school-modules";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { FEATURE_STATUS_LABELS, getFeatureRequest, nextStatuses } from "@/server/platform/feature-requests";

export const metadata: Metadata = { title: "Feature request" };

export default async function SuperFeatureRequestPage(props: PageProps<"/super-admin/feature-requests/[requestId]">) {
  const user = await requireSuperAdmin();
  const { requestId } = await props.params;
  const row = await getFeatureRequest(user, requestId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [plans, organizations] = await Promise.all([
    prisma.plan.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { displayOrder: "asc" }, select: { id: true, name: true } }),
    prisma.organization.findMany({ where: { schools: { some: { isDemo: false } } }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
  ]);
  const statuses = [row.status, ...nextStatuses(row.status)].map((status) => ({ value: status, label: status === row.status ? `${FEATURE_STATUS_LABELS[status]} (current)` : FEATURE_STATUS_LABELS[status] }));
  return (
    <>
      <PageHeader icon={LightbulbIcon} tone="amber" title={row.title} description={`${row.organization.name}${row.school ? ` · ${row.school.name}` : ""} · requested by ${row.requestedBy ? `${row.requestedBy.firstName} ${row.requestedBy.lastName} (${row.requestedBy.email})` : "—"}`} actions={<StatusBadge status={row.status} label={FEATURE_STATUS_LABELS[row.status]} />} />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Request</CardTitle>
              <CardDescription>{`${row.priority.toLowerCase()} priority${row.moduleKey ? ` · ${moduleLabel(row.moduleKey)}` : ""}`}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="whitespace-pre-line">{`Problem: ${row.problem}`}</p>
              <p className="whitespace-pre-line">{row.description}</p>
              {row.expectedOutcome ? <p className="whitespace-pre-line">{`Expected outcome: ${row.expectedOutcome}`}</p> : null}
              {row.examples ? <p className="text-muted-foreground whitespace-pre-line">{`Examples: ${row.examples}`}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3 text-sm">
                {row.events.map((event) => (
                  <li key={event.id} className="border-l-2 pl-3">
                    <p className="text-muted-foreground text-xs">{`${formatDateTime(event.createdAt)} · ${event.actor ? `${event.actor.firstName} ${event.actor.lastName}` : "—"}${event.fromStatus && event.toStatus ? ` · ${FEATURE_STATUS_LABELS[event.fromStatus]} → ${FEATURE_STATUS_LABELS[event.toStatus]}` : event.toStatus ? ` · ${FEATURE_STATUS_LABELS[event.toStatus]}` : ""}${event.internal ? " · internal" : ""}`}</p>
                    {event.body ? <p className="whitespace-pre-line">{event.body}</p> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Decide</CardTitle>
            <CardDescription>{row.status === "RELEASED" ? "Released. Details can still be corrected." : "Move the request on, or update its estimate."}</CardDescription>
          </CardHeader>
          <CardContent>
            <FeatureDecisionForm
              request={row}
              statuses={statuses}
              plans={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
              organizations={organizations.map((org) => ({ value: org.id, label: org.name }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
