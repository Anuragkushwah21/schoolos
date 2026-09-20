import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercent, humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getParentChildren } from "@/server/people/portal";

export const metadata: Metadata = { title: "Children" };

export default async function ParentChildrenPage() {
  const ctx = await requireTenant("PARENT");
  const { children, session } = await getParentChildren(ctx);

  if (!children.length) {
    return (
      <>
        <PageHeader title="Children" />
        <EmptyState title="No children linked to your account yet" />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Children" description={session ? `Session ${session.name}` : undefined} />
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Child</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Today</TableHead>
              <TableHead className="text-right">Attendance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {children.map((child) => (
              <TableRow key={child.id}>
                <TableCell>
                  <Link href={`/parent/children/${child.id}`} className="font-medium hover:underline">
                    {child.name}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {child.admissionNumber} · {humanize(child.relationship)}
                  </p>
                </TableCell>
                <TableCell>{child.sectionLabel ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  {child.todayStatus ? (
                    <StatusBadge status={child.todayStatus} />
                  ) : (
                    <span className="text-muted-foreground text-sm">Not marked</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(child.counts.PRESENT + child.counts.LATE, child.counts.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
