import type { Metadata } from "next";
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

const STATUS_LABEL: Record<(typeof STATUS_FILTERS)[number], string> = {
  REVIEW: "Awaiting review",
  PENDING: "Pending",
  UNDER_REVIEW: "Under review",
  ACTIVE: "Active",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  INACTIVE: "Inactive",
};

export default async function SchoolsPage(props: PageProps<"/super-admin/schools">) {
  const user = await requireSuperAdmin();
  const search = await props.searchParams;

  const status = enumParam(search.status, STATUS_FILTERS);
  const q = param(search.q);
  const { rows, total, page, pageCount } = await listSchools(user, {
    status,
    q,
    page: pageParam(search.page),
  });

  return (
    <>
      <PageHeader title="Schools" description="Registrations and every school on the platform." />

      <FilterBar
        action="/super-admin/schools"
        search={{ defaultValue: q, placeholder: "Search name, city or email" }}
        selects={[
          {
            name: "status",
            label: "Status",
            defaultValue: status,
            allLabel: "All statuses",
            options: STATUS_FILTERS.map((value) => ({ value, label: STATUS_LABEL[value] })),
          },
        ]}
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
