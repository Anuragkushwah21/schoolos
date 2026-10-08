import type { Metadata } from "next";
import Link from "next/link";
import { Building2Icon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { REQUEST_STATUS } from "@/features/campuses/status";
import type { CampusRequestStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/dates";
import { moduleLabel } from "@/lib/school-modules";
import { cleanLimits, describeLimits, roleLabel } from "@/lib/school-roles";
import { param } from "@/lib/search-params";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listCampusRequests } from "@/server/campuses/requests";

export const metadata: Metadata = { title: "Campus requests" };

const VIEWS: Array<{ key: CampusRequestStatus | "ALL"; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "UNDER_REVIEW", label: "Under review" },
  { key: "APPROVED", label: "Approved" },
  { key: "MODIFIED", label: "Modified" },
  { key: "REJECTED", label: "Rejected" },
];

/** Requests from owners for another campus. Nothing exists until approved here. */
export default async function CampusRequestsPage(props: PageProps<"/super-admin/campus-requests">) {
  const user = await requireSuperAdmin();
  const asked = param((await props.searchParams).status);
  const view = VIEWS.find((item) => item.key === asked)?.key ?? "ALL";
  const rows = await listCampusRequests(user, view === "ALL" ? null : view);
  return (
    <>
      <PageHeader icon={Building2Icon} tone="blue" title="Campus requests" description="Owners asking to open another school/campus. Review, approve as asked or with changes, or reject with a reason." />
      <ViewTabs label="Status" tabs={VIEWS.map((item) => ({ href: item.key === "ALL" ? "/super-admin/campus-requests" : `/super-admin/campus-requests?status=${item.key}`, label: item.label, active: item.key === view }))} />
      {rows.length ? (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const status = REQUEST_STATUS[row.status]!;
            return (
              <li key={row.id}>
                <Link href={`/super-admin/campus-requests/${row.id}`} className="block">
                  <Card className="hover:bg-muted/30 transition-colors">
                    <CardContent className="flex flex-col gap-1.5 pt-5 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{row.name}</span>
                        <StatusBadge status={row.status} label={status.label} tone={status.tone} />
                        <span className="text-muted-foreground ml-auto font-mono text-xs">{row.id.slice(-8).toUpperCase()}</span>
                      </div>
                      <p className="text-muted-foreground">{`${row.organization.name}${row.organization.owner ? ` · owner ${row.organization.owner.firstName} ${row.organization.owner.lastName}` : ""} · ${row.campuses} campus${row.campuses === 1 ? "" : "es"} now · ${row.city}, ${row.state} · ${formatDate(row.createdAt)}`}</p>
                      <p>{`Modules: ${row.requestedModules.map(moduleLabel).join(", ") || "core only"}`}</p>
                      <p>{`Roles: ${row.requestedRoles.map(roleLabel).join(", ") || "core only"} · Limits: ${describeLimits(cleanLimits(row.requestedLimits))}`}</p>
                      {row.entitlementNotes.length ? <p className="text-warning-strong text-xs">{`Needs entitlement: ${row.entitlementNotes.join(" ")}`}</p> : null}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={Building2Icon} title="No campus requests">Requests appear here when an owner asks for another campus.</EmptyState>
      )}
    </>
  );
}
