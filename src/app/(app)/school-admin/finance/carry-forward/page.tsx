import type { Metadata, Route } from "next";
import Link from "next/link";
import { HistoryIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { carryForwardAction } from "@/features/finance/family-actions";
import { CarryForwardAllForm } from "@/features/finance/carry-forward-form";
import { rupees } from "@/features/finance/money";
import { param } from "@/lib/search-params";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { carryForwardCandidates } from "@/server/finance/carry-forward";

export const metadata: Metadata = { title: "Carry forward" };

/**
 * Earlier sessions' unpaid fees, for students still at the school. Nothing
 * moves by itself: "Carry forward outstanding" adds an explicit "Previous
 * outstanding (2025-26)" charge to this session, linked to where it came from.
 */
export default async function CarryForwardPage(props: PageProps<"/school-admin/finance/carry-forward">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Carry forward" need="session" />;
  const search = await props.searchParams;
  const sectionId = param(search.section);
  const [rows, sections] = await Promise.all([carryForwardCandidates(ctx, { sectionId }), sectionOptions(ctx, session.id)]);
  const total = rows.reduce((sum, row) => sum + row.totalMinor, 0);

  return (
    <>
      <PageHeader
        icon={HistoryIcon}
        tone="orange"
        title="Carry forward outstanding"
        description={`Unpaid fees from earlier sessions for students now in ${session.name}: ${rupees(total)} across ${rows.length} student${rows.length === 1 ? "" : "s"}.`}
      />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <FilterBar action="/school-admin/finance/carry-forward" selects={[{ name: "section", label: "Section", defaultValue: sectionId, allLabel: "All sections", options: sections }]} />
          {rows.length ? (
            <div className="bg-card shadow-card overflow-hidden rounded-2xl border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Now in</TableHead>
                    <TableHead>Still owed</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.studentId}>
                      <TableCell>
                        <Link href={`/school-admin/finance/payments?student=${row.studentId}` as Route} className="font-medium hover:underline">
                          {row.name}
                        </Link>
                        <span className="text-muted-foreground block text-xs">{row.admissionNumber}</span>
                      </TableCell>
                      <TableCell>{row.section}</TableCell>
                      <TableCell>
                        {row.dues.map((due) => (
                          <span key={due.sessionId} className="block tabular-nums">
                            {due.sessionName}: <strong>{rupees(due.pendingMinor)}</strong>
                          </span>
                        ))}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.dues.map((due) => (
                          <ActionButton key={due.sessionId} action={carryForwardAction} fields={{ studentId: row.studentId, fromSessionId: due.sessionId }} variant="outline">
                            Carry forward {rupees(due.pendingMinor)}
                          </ActionButton>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState icon={HistoryIcon} tone="green" title="Nothing to carry forward">
              No student here owes fees from an earlier session (or it has already been carried forward).
            </EmptyState>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>All at once</CardTitle>
            <CardDescription>Carries forward every balance in the list (for one section, if chosen). Each becomes its own line on the student&apos;s fees, naming the session it came from.</CardDescription>
          </CardHeader>
          <CardContent>
            <CarryForwardAllForm sections={sections} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
