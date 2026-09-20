import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, parseDateInput, today, toDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { schoolReport, sectionReport } from "@/server/attendance/service";

export const metadata: Metadata = { title: "Reports" };

/** Below this, a student is flagged for follow-up. */
const LOW_ATTENDANCE = 0.75;

function Share({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("font-medium tabular-nums", value < LOW_ATTENDANCE && "text-red-600 dark:text-red-400")}>
      {Math.round(value * 100)}%
    </span>
  );
}

function Bar({ value }: { value: number | null }) {
  return (
    <div className="bg-muted h-2 w-full min-w-16 overflow-hidden rounded-full" aria-hidden>
      <div
        className={cn("h-full rounded-full", value !== null && value < LOW_ATTENDANCE ? "bg-red-500" : "bg-primary")}
        style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
      />
    </div>
  );
}

export default async function ReportsPage(props: PageProps<"/admin/reports">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);

  if (!session) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState title="No current academic session" />
      </>
    );
  }

  const now = today();
  const to = parseDateInput(param(search.to)) ?? (now < session.endDate ? now : session.endDate);
  const from = parseDateInput(param(search.from)) ?? session.startDate;
  const sections = await sectionOptions(ctx, session.id);
  const sectionId = sections.find((s) => s.value === param(search.section))?.value;

  const range = { from: toDateInput(from), to: toDateInput(to) };

  return (
    <>
      <PageHeader
        title="Attendance reports"
        description={`${formatDate(from)} – ${formatDate(to)} · students below ${LOW_ATTENDANCE * 100}% are shown in red.`}
        actions={
          sectionId ? (
            <Button asChild variant="outline">
              <Link href={`/admin/reports/export?section=${sectionId}&from=${range.from}&to=${range.to}`} prefetch={false}>
                Download CSV
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        action="/admin/reports"
        selects={[
          { name: "section", label: "Section", defaultValue: sectionId, allLabel: "Whole school", options: sections },
        ]}
        dates={[
          { name: "from", label: "From", defaultValue: range.from },
          { name: "to", label: "To", defaultValue: range.to },
        ]}
      />

      {sectionId ? (
        <SectionReport ctx={ctx} sectionId={sectionId} from={from} to={to} />
      ) : (
        <SchoolReport ctx={ctx} sessionId={session.id} from={from} to={to} range={range} />
      )}
    </>
  );
}

async function SchoolReport({
  ctx,
  sessionId,
  from,
  to,
  range,
}: {
  ctx: Awaited<ReturnType<typeof requireTenant>>;
  sessionId: string;
  from: Date;
  to: Date;
  range: { from: string; to: string };
}) {
  const rows = await schoolReport(ctx, sessionId, from, to);
  if (!rows.length) return <EmptyState title="No sections this session" />;

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Section</TableHead>
            <TableHead className="text-right">Students</TableHead>
            <TableHead className="text-right">Marks</TableHead>
            <TableHead className="text-right">Absent</TableHead>
            <TableHead className="w-40">Attended</TableHead>
            <TableHead className="text-right">%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link
                  href={`/admin/reports?section=${row.id}&from=${range.from}&to=${range.to}`}
                  className="font-medium hover:underline"
                >
                  {row.label}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.students}</TableCell>
              <TableCell className="text-right tabular-nums">{row.counts.total}</TableCell>
              <TableCell className="text-right tabular-nums">{row.counts.ABSENT}</TableCell>
              <TableCell>
                <Bar value={row.share} />
              </TableCell>
              <TableCell className="text-right">
                <Share value={row.share} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function SectionReport({
  ctx,
  sectionId,
  from,
  to,
}: {
  ctx: Awaited<ReturnType<typeof requireTenant>>;
  sectionId: string;
  from: Date;
  to: Date;
}) {
  const report = await sectionReport(ctx, sectionId, from, to);
  const flagged = report.students.filter((s) => s.share !== null && s.share < LOW_ATTENDANCE);
  const overall =
    report.totals.total ? (report.totals.PRESENT + report.totals.LATE) / report.totals.total : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Days marked", value: report.markedDays },
          { label: "Overall attendance", value: overall === null ? "—" : `${Math.round(overall * 100)}%` },
          { label: "Absences", value: report.totals.ABSENT },
          { label: "Below 75%", value: flagged.length },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-0">
              <CardTitle className="text-muted-foreground text-sm font-medium">{stat.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead className="text-right">Present</TableHead>
              <TableHead className="text-right">Late</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">Excused</TableHead>
              <TableHead className="w-40">Attended</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.students.map((student) => (
              <TableRow key={student.studentId}>
                <TableCell>
                  <Link href={`/admin/students/${student.studentId}`} className="font-medium hover:underline">
                    {student.name}
                  </Link>
                  {student.rollNumber ? (
                    <span className="text-muted-foreground text-xs"> · roll {student.rollNumber}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{student.counts.PRESENT}</TableCell>
                <TableCell className="text-right tabular-nums">{student.counts.LATE}</TableCell>
                <TableCell className="text-right tabular-nums">{student.counts.ABSENT}</TableCell>
                <TableCell className="text-right tabular-nums">{student.counts.EXCUSED}</TableCell>
                <TableCell>
                  <Bar value={student.share} />
                </TableCell>
                <TableCell className="text-right">
                  <Share value={student.share} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
