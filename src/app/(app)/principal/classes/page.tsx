import type { Metadata } from "next";
import { SchoolIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { classPerformance } from "@/server/principal/overview";

export const metadata: Metadata = { title: "Classes" };

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

/** Every class: strength, class teacher, attendance (30 days) and test average (60 days). Below 75% / 40% is flagged. */
export default async function PrincipalClassesPage() {
  const ctx = await requireTenant("PRINCIPAL");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Classes" need="session" />;
  const rows = await classPerformance(ctx, session.id);
  return (
    <>
      <PageHeader icon={SchoolIcon} tone="blue" title="Class performance" description={`${session.name} · attendance over the last 30 days and test averages over the last 60. Low figures are in red.`} />
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead className="hidden sm:table-cell">Class teacher</TableHead>
                <TableHead className="text-right">Students</TableHead>
                <TableHead className="text-right">Attendance</TableHead>
                <TableHead className="text-right">Test average</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell">{row.classTeacher ?? "Not assigned"}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.students}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", row.attendance !== null && row.attendance < 0.75 && "text-danger-strong font-semibold")}>{pct(row.attendance)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", row.averageScore !== null && row.averageScore < 0.4 && "text-danger-strong font-semibold")}>{pct(row.averageScore)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No classes with students yet" />
      )}
    </>
  );
}
