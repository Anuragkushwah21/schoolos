import type { Metadata } from "next";
import Link from "next/link";
import { Building2Icon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listOrganizations } from "@/server/platform/organizations";

export const metadata: Metadata = { title: "Organizations" };

/**
 * Every customer: the owner's organization, how many campuses it runs, and
 * its plan. The plan is changed from the organization's page, for all of
 * its campuses at once.
 */
export default async function OrganizationsPage(props: PageProps<"/super-admin/organizations">) {
  const user = await requireSuperAdmin();
  const q = param((await props.searchParams).q) ?? null;
  const rows = await listOrganizations(user, q);
  return (
    <>
      <PageHeader icon={Building2Icon} tone="blue" title="Organizations" description="Each customer account and its campuses. Open one to see or change its plan — the plan applies to every campus." />
      <FilterBar action="/super-admin/organizations" search={{ defaultValue: q ?? undefined, placeholder: "Search organization, campus or owner email" }} />
      {rows.length ? (
        <div className="bg-card shadow-card overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Campuses</TableHead>
                <TableHead>Plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/super-admin/organizations/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{row.owner ? `${row.owner.firstName} ${row.owner.lastName}` : "No owner yet"}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.campuses}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      {row.plan ? row.plan.name : "No plan"}
                      {row.status && row.status !== "ACTIVE" ? <StatusBadge status={row.status} label={humanize(row.status)} /> : null}
                      {row.mixedPlans ? <StatusBadge status="MIXED" label="Campuses on different plans" tone="warning" /> : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={Building2Icon} tone="neutral" title={q ? "No organization matches" : "No organizations yet"}>
          {q ? "Try another name or email." : "An organization is created when a school registers."}
        </EmptyState>
      )}
    </>
  );
}
