import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ActionButton } from "@/components/forms/action-button";
import { setFeeHeadActiveAction } from "@/features/finance/actions";
import { ChargeSectionForm, FeeHeadForm } from "@/features/finance/forms";
import { FEE_STATUS_LABEL, FEE_STATUS_TONE, rupees } from "@/features/finance/money";
import { addDays, formatDate, toDateInput, today } from "@/lib/dates";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { FEE_STATUSES, listFeeHeads, listFeePositions } from "@/server/finance/fees";

export const metadata: Metadata = { title: "Fee collection" };

/**
 * Who owes what, and the two ways the office raises a charge.
 *
 * Searchable by the student *and* by their parent, because a parent ringing up
 * about fees gives their own name, not their child's admission number.
 */
export default async function FeeCollectionPage(props: PageProps<"/school-admin/finance/fees">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Fee collection" need="session" />;

  const search = await props.searchParams;
  const q = param(search.q);
  const sectionId = param(search.section);
  const status = enumParam(search.status, FEE_STATUSES);

  const [fees, heads, sections] = await Promise.all([
    listFeePositions(ctx, { q, sectionId, status, page: pageParam(search.page) }),
    listFeeHeads(ctx),
    sectionOptions(ctx, session.id),
  ]);

  const activeHeads = heads.filter((head) => head.isActive);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/finance", label: "Finance" }}
        title="Fee collection"
        description={`${session.name} · charges and what is still owed`}
        actions={
          <Button asChild variant="outline">
            <Link href="/school-admin/finance/payments">Record a payment</Link>
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Charged" value={rupees(fees.totals?.chargedMinor ?? 0)} />
        <StatCard label="Collected" value={rupees(fees.totals?.paidMinor ?? 0)} />
        <StatCard label="Pending" value={rupees(fees.totals?.pendingMinor ?? 0)} />
        <StatCard label="Overdue students" value={fees.totals?.overdue ?? 0} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Charge a class</CardTitle>
            <CardDescription>
              Writes one charge per enrolled student, so a single family&apos;s amount can still be
              corrected afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeHeads.length && sections.length ? (
              <ChargeSectionForm
                sections={sections}
                heads={activeHeads.map((head) => ({ value: head.id, label: head.name }))}
                defaultDueOn={toDateInput(addDays(today(), 30))}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                Add a fee head below{sections.length ? "" : " and create sections"} first.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fee heads</CardTitle>
            <CardDescription>
              What this school charges for. Configurable — no two schools bill the same things.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {heads.length ? (
              <ul className="divide-y rounded-lg border">
                {heads.map((head) => (
                  <li key={head.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{head.name}</span>
                      {head.note ? (
                        <span className="text-muted-foreground block text-xs">{head.note}</span>
                      ) : null}
                    </span>
                    {head.isActive ? null : (
                      <StatusBadge status="INACTIVE" label="Inactive" tone="neutral" />
                    )}
                    <ActionButton
                      action={setFeeHeadActiveAction}
                      fields={{ feeHeadId: head.id, isActive: head.isActive ? "" : "true" }}
                      variant="ghost"
                      size="xs"
                      pendingLabel="Saving…"
                    >
                      {head.isActive ? "Deactivate" : "Reactivate"}
                    </ActionButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">None yet.</p>
            )}
            <FeeHeadForm />
          </CardContent>
        </Card>
      </div>

      <FilterBar
        action="/school-admin/finance/fees"
        search={{ defaultValue: q, placeholder: "Student, admission no, parent name or mobile" }}
        selects={[
          {
            name: "section",
            label: "Class",
            defaultValue: sectionId,
            allLabel: "All classes",
            options: sections,
          },
          {
            name: "status",
            label: "Status",
            defaultValue: status,
            allLabel: "Any status",
            options: FEE_STATUSES.map((value) => ({ value, label: FEE_STATUS_LABEL[value] })),
          },
        ]}
      />

      {fees.rows.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="hidden lg:table-cell">Parent</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fees.rows.map((row) => (
                <TableRow key={row.studentId}>
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    <p className="text-muted-foreground text-xs">{row.admissionNumber}</p>
                  </TableCell>
                  <TableCell>{row.section}</TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell">
                    {row.parentName ?? "—"}
                    {row.parentPhone ? <p className="text-xs">{row.parentPhone}</p> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rupees(row.summary.chargedMinor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rupees(row.summary.paidMinor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rupees(row.summary.pendingMinor)}
                    {row.summary.overdue ? (
                      <span className="block text-xs" style={{ color: "var(--viz-warning)" }}>
                        due {formatDate(row.summary.dueOn)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.summary.status}
                      label={FEE_STATUS_LABEL[row.summary.status]}
                      tone={FEE_STATUS_TONE[row.summary.status]}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/school-admin/students/${row.studentId}` as Route}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title={q || sectionId || status ? "Nothing matches those filters" : "Nothing charged yet"}>
          Add a fee head, then charge a class. What each family owes is worked out from those
          charges and whatever has been received.
        </EmptyState>
      )}

      <Pager
        page={fees.page}
        pageCount={fees.pageCount}
        total={fees.total}
        basePath="/school-admin/finance/fees"
        params={{ q, section: sectionId, status }}
      />
    </>
  );
}
