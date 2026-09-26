import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rupees } from "@/features/finance/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { listSalaries } from "@/server/finance/salary";

export const metadata: Metadata = { title: "Salaries" };

/**
 * What the school pays its staff.
 *
 * School Admin only, like everything in `server/finance/salary.ts`. A teacher can
 * see their own figure on their own record and nobody else's; students and
 * parents cannot reach any of it.
 */
export default async function SalariesPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { rows, totals } = await listSalaries(ctx);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/finance", label: "Finance" }}
        title="Salaries"
        description="Only you and the teacher themselves can see these figures."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Monthly bill" value={rupees(totals.monthlyMinor)} hint="configured staff" />
        <StatCard label="Configured" value={totals.configured} />
        <StatCard
          label="Not set"
          value={totals.missing}
          hint={totals.missing ? "still to enter" : "all done"}
        />
      </div>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teacher</TableHead>
                <TableHead className="hidden md:table-cell">Designation</TableHead>
                <TableHead className="text-right">Salary</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="hidden w-32 lg:table-cell">Effective from</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.teacherId}>
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    <p className="text-muted-foreground text-xs">{row.employeeId}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell">
                    {row.designation ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.current ? rupees(row.current.amountMinor) : "—"}
                    {row.current ? (
                      <span className="text-muted-foreground block text-xs">
                        {humanize(row.current.salaryType).toLowerCase()}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.current ? rupees(row.current.netMinor) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden tabular-nums lg:table-cell">
                    {row.current ? formatDate(row.current.effectiveFrom) : "—"}
                    {row.scheduled ? (
                      <span className="block text-xs">
                        from {formatDate(row.scheduled.effectiveFrom)}:{" "}
                        {rupees(row.scheduled.amountMinor)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.current ? (
                      <StatusBadge status="ACTIVE" label="Configured" />
                    ) : (
                      <StatusBadge status="PENDING" label="Not set" />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/school-admin/teachers/${row.teacherId}` as Route}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No teachers yet">
          Add staff first; their salary is entered on their own record and is never required to
          create them.
        </EmptyState>
      )}
    </>
  );
}
