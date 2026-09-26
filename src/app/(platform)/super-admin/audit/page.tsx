import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listAuditLog } from "@/server/platform/audit";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage(props: PageProps<"/super-admin/audit">) {
  const user = await requireSuperAdmin();
  const search = await props.searchParams;

  const action = enumParam(search.action, AUDIT_ACTIONS);
  const q = param(search.q);
  const schoolId = param(search.schoolId);
  const { rows, total, page, pageCount } = await listAuditLog(user, {
    action,
    q,
    schoolId,
    page: pageParam(search.page),
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Consequential actions across the platform, newest first."
      />

      <FilterBar
        action="/super-admin/audit"
        hidden={{ schoolId }}
        search={{ defaultValue: q, placeholder: "Search summaries" }}
        selects={[
          {
            name: "action",
            label: "Action",
            defaultValue: action,
            allLabel: "All actions",
            options: AUDIT_ACTIONS.map((value) => ({ value, label: humanize(value) })),
          },
        ]}
      />
      {schoolId ? (
        <p className="text-muted-foreground mb-4 text-sm">
          Showing one school only. <Link href="/super-admin/audit" className="underline">Show all</Link>
        </p>
      ) : null}

      {rows.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>School</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{humanize(row.action)}</TableCell>
                  <TableCell className="max-w-md whitespace-normal">{row.summary}</TableCell>
                  <TableCell>
                    {row.school ? (
                      <Link href={`/super-admin/schools/${row.school.id}`} className="hover:underline">
                        {row.school.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Platform</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.actor?.email ?? row.ipAddress ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No entries match" />
      )}

      <Pager
        page={page}
        pageCount={pageCount}
        total={total}
        basePath="/super-admin/audit"
        params={{ action, q, schoolId }}
      />
    </>
  );
}
