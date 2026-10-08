import type { Metadata, Route } from "next";
import Link from "next/link";
import { ClipboardListIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { RequestStatusBadge, requestRef } from "@/features/campuses/request-views";
import { formatDate } from "@/lib/dates";
import { moduleLabel } from "@/lib/school-modules";
import { cleanLimits, describeLimits, roleLabel } from "@/lib/school-roles";
import { requireTenant } from "@/server/auth/current-user";
import { campusRequestOverview } from "@/server/campuses/requests";

export const metadata: Metadata = { title: "My Campus Requests" };

/** Every request this organization sent, newest first, with SchoolOS's decision. */
export default async function MyCampusRequestsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const overview = await campusRequestOverview(ctx);
  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/campuses" as Route, label: "My Schools" }}
        icon={ClipboardListIcon}
        tone="blue"
        title="My Campus Requests"
        description="Requests for a new school/campus and what SchoolOS decided."
        actions={
          overview.canRequest ? (
            <Button asChild>
              <Link href="/school-admin/campuses/request">Request New School/Campus</Link>
            </Button>
          ) : null
        }
      />
      {overview.entitlement ? <p className="bg-info-soft text-info-strong mb-6 rounded-xl border px-4 py-3 text-sm">{overview.entitlement}</p> : null}
      {overview.requests.length ? (
        <div className="bg-card overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th className="px-4 py-3 font-medium">Request</th>
                <th className="px-4 py-3 font-medium">School</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Modules · roles · limits</th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {overview.requests.map((request) => {
                const decided = request.status === "APPROVED" || request.status === "MODIFIED";
                return (
                  <tr key={request.id}>
                    <td className="px-4 py-3">
                      <Link className="text-primary font-mono font-medium hover:underline" href={`/school-admin/campuses/requests/${request.id}` as Route}>
                        {requestRef(request.id)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{request.name}</span>
                      <span className="text-muted-foreground block text-xs">{request.city}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatDate(request.createdAt)}</td>
                    <td className="px-4 py-3">
                      <RequestStatusBadge status={request.status} />
                      {request.rejectionReason ? <span className="text-danger-strong mt-1 block text-xs">{request.rejectionReason}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="block">{(decided ? request.approvedModules : request.requestedModules).map(moduleLabel).join(", ") || "core only"}</span>
                      <span className="block">{(decided ? request.approvedRoles : request.requestedRoles).map(roleLabel).join(", ") || "core only"}</span>
                      <span className="text-muted-foreground block">{describeLimits(cleanLimits(decided ? request.approvedLimits : request.requestedLimits))}</span>
                      {decided ? <span className="text-muted-foreground block">as approved</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={ClipboardListIcon} title="No campus requests yet">
          {overview.canRequest ? "Use Request New School/Campus to ask SchoolOS for another school." : "Your requests will appear here."}
        </EmptyState>
      )}
    </>
  );
}
