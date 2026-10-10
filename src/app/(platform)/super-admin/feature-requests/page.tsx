import type { Metadata } from "next";
import Link from "next/link";
import { LightbulbIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { formatDate } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { FEATURE_STATUSES } from "@/lib/validation/feature-requests";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { FEATURE_STATUS_LABELS, listFeatureRequests } from "@/server/platform/feature-requests";

export const metadata: Metadata = { title: "Feature requests" };

/** Custom feature requests from school owners, by status. */
export default async function SuperFeatureRequestsPage(props: PageProps<"/super-admin/feature-requests">) {
  const user = await requireSuperAdmin();
  const asked = param((await props.searchParams).status);
  const view = (FEATURE_STATUSES as readonly string[]).includes(asked ?? "") ? (asked as (typeof FEATURE_STATUSES)[number]) : null;
  const rows = await listFeatureRequests(user, view);
  return (
    <>
      <PageHeader icon={LightbulbIcon} tone="amber" title="Feature requests" description="What school owners ask for. Agree cost, scope and timeline before development; decide explicitly what a released feature becomes." />
      <ViewTabs label="Status" tabs={[{ href: "/super-admin/feature-requests", label: "All", active: view === null }, ...FEATURE_STATUSES.map((key) => ({ href: `/super-admin/feature-requests?status=${key}`, label: FEATURE_STATUS_LABELS[key], active: view === key }))]} />
      {rows.length ? (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/super-admin/feature-requests/${row.id}`} className="bg-card hover:bg-muted/40 flex flex-col gap-1 rounded-xl border p-4">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{row.title}</span>
                  <StatusBadge status={row.status} label={FEATURE_STATUS_LABELS[row.status]} />
                </span>
                <span className="text-muted-foreground text-xs">{`${row.organization.name}${row.school ? ` · ${row.school.name}` : ""} · ${formatDate(row.createdAt)} · ${row.priority.toLowerCase()} priority`}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={LightbulbIcon} tone="neutral" title="No feature requests">
          Requests from school owners appear here.
        </EmptyState>
      )}
    </>
  );
}
