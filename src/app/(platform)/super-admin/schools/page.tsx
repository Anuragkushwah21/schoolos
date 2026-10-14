import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listSchools } from "@/server/platform/schools";
import { roleUsage } from "@/server/platform/role-usage";
import { roleLabel } from "@/lib/school-roles";
import { schoolsByStatus } from "@/server/analytics/platform";
import { ViewTabs } from "@/components/shared/view-tabs";

export const metadata: Metadata = { title: "Schools" };

const STATUS_FILTERS = [
  "REVIEW",
  "PENDING",
  "UNDER_REVIEW",
  "ACTIVE",
  "REJECTED",
  "SUSPENDED",
  "INACTIVE",
] as const;

export default async function SchoolsPage(props: PageProps<"/super-admin/schools">) {
  const user = await requireSuperAdmin();
  const search = await props.searchParams;

  const status = enumParam(search.status, STATUS_FILTERS);
  const q = param(search.q);
  const [{ rows, total, page, pageCount }, counts] = await Promise.all([
    listSchools(user, { status, q, page: pageParam(search.page) }),
    schoolsByStatus(user),
  ]);
  const usage = await roleUsage(user, rows.map((school) => school.id));
  const tab = (value: (typeof STATUS_FILTERS)[number] | null, label: string, count: number) => ({
    href: (value ? `/super-admin/schools?status=${value}` : "/super-admin/schools") as Route,
    label,
    count,
    active: (status ?? null) === value,
  });

  return (
    <>
      <PageHeader title="Schools" description="Registrations and every school on the platform." />

      <div className="mb-4">
        <ViewTabs
          label="Schools by status"
          tabs={[
            tab(null, "All schools", counts.total),
            tab("REVIEW", "Pending approval", counts.awaitingReview),
            tab("ACTIVE", "Active", counts.active),
            tab("SUSPENDED", "Suspended", counts.suspended),
            tab("REJECTED", "Rejected", counts.rejected),
          ]}
        />
      </div>

      <FilterBar
        action="/super-admin/schools"
        search={{ defaultValue: q, placeholder: "Search name, city or email" }}
        hidden={{ status }}
      />

      {rows.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Students</TableHead>
                <TableHead className="text-right">Teachers</TableHead>
                <TableHead>Roles in use</TableHead>
                <TableHead>Registered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((school) => {
                const subscription = school.subscriptions[0];
                return (
                  <TableRow key={school.id}>
                    <TableCell>
                      <Link href={`/super-admin/schools/${school.id}`} className="font-medium hover:underline">
                        {school.name}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {[school.city, school.state].filter(Boolean).join(", ") || school.slug}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={school.status} />
                        {school.contactEmailVerifiedAt ? null : (
                          <StatusBadge status="PENDING" label="Email not verified" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {subscription ? (
                        <span className="text-sm">{subscription.plan.name}</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{school._count.students}</TableCell>
                    <TableCell className="text-right tabular-nums">{school._count.teachers}</TableCell>
                    <TableCell className="max-w-72">
                      {(() => {
                        const roles = usage.get(school.id);
                        if (!roles) return <span className="text-muted-foreground text-sm">—</span>;
                        return (
                          <Link href={`/super-admin/schools/${school.id}#role-usage`} className="block hover:underline">
                            <span className="text-sm font-medium">{`${roles.inUse.length} in use · ${roles.enabledCount} switched on`}</span>
                            <span className="text-muted-foreground block text-xs">{roles.inUse.length ? roles.inUse.map((row) => `${roleLabel(row.role)} ${row.people}`).join(" · ") : "No staff roles filled yet"}</span>
                          </Link>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(school.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No schools match">Try a different search or status.</EmptyState>
      )}

      <Pager
        page={page}
        pageCount={pageCount}
        total={total}
        basePath="/super-admin/schools"
        params={{ status, q }}
      />
    </>
  );
}
