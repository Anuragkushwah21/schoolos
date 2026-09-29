import type { Metadata } from "next";

import { ChartFigure } from "@/components/charts/chart-figure";
import { TrendArea } from "@/components/charts/trend-area";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PublishedExams } from "@/features/exams/published-exams";
import { ChildTabs } from "@/features/parent/child-nav";
import { formatDate } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { publishedExamsFor } from "@/server/exams/results";
import { getChildResults } from "@/server/parent/child";

export const metadata: Metadata = { title: "Tests & results" };

const DIRECTION_LABEL = {
  up: "Improving",
  down: "Slipping",
  flat: "Steady",
} as const;

/**
 * Every assessment this child's class has sat, with their own mark.
 *
 * Percentages are computed from the mark and the paper's total rather than
 * stored, so correcting a total corrects every figure. A trend is only claimed
 * once there are two results in a subject to compare — one mark is a point, not
 * a direction.
 */
export default async function ChildResultsPage(
  props: PageProps<"/parent/children/[studentId]/results">,
) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const { child, entries, subjects, overall, satCount } = await orNotFound(
    getChildResults(ctx, studentId),
  );
  // After the guardian check above; `publishedExamsFor` repeats it anyway.
  const exams = await publishedExamsFor(ctx, studentId);

  const missed = entries.filter((entry) => !entry.sat).length;

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={`${child.student.name} — tests & results`}
        description={`${child.placement.sectionLabel} · ${child.placement.sessionName}`}
      />
      <ChildTabs studentId={studentId} active="results" />
      <PublishedExams exams={exams} studentId={studentId} />

      {entries.length === 0 ? (
        <EmptyState title="No tests recorded yet">
          Marks appear here once {child.student.name.split(" ")[0]}&apos;s teachers enter them. The
          portal shows what the school recorded and nothing else.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Average"
              value={overall === null ? "—" : `${Math.round(overall * 100)}%`}
              hint={`across ${pluralize(satCount, "test")}`}
            />
            <StatCard label="Tests sat" value={satCount} />
            <StatCard label="Not sat" value={missed} hint={missed ? "absent or exempted" : undefined} />
            <StatCard label="Subjects" value={subjects.length} />
          </div>

          <div className="flex flex-col gap-6">
            {subjects.length ? (
              <div className="grid gap-6 xl:grid-cols-2">
                {subjects.map((group) => (
                  <Card key={group.subject}>
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                      <div>
                        <CardTitle>{group.subject}</CardTitle>
                        <CardDescription>
                          {group.average === null
                            ? "Not enough marks yet"
                            : `Averaging ${Math.round(group.average * 100)}% over ${pluralize(group.points.length, "test")}`}
                        </CardDescription>
                      </div>
                      {group.direction ? (
                        <StatusBadge
                          status={
                            group.direction === "up"
                              ? "ACTIVE"
                              : group.direction === "down"
                                ? "NEEDS_ATTENTION"
                                : "AVERAGE"
                          }
                          label={DIRECTION_LABEL[group.direction]}
                        />
                      ) : null}
                    </CardHeader>
                    <CardContent>
                      <ChartFigure
                        title={`${group.subject} over time`}
                        subtitle="Oldest test first."
                        table={{
                          head: ["Test", "Marks", "Percent"],
                          rows: group.points.map((point) => [
                            point.name,
                            `${point.marksObtained}/${point.maxMarks}`,
                            point.share === null ? "—" : `${Math.round(point.share * 100)}%`,
                          ]),
                        }}
                      >
                        <TrendArea
                          data={group.points.map((point) => ({
                            key: point.id,
                            label: point.name,
                            value: point.share === null ? null : Math.round(point.share * 100),
                            detail: `${point.marksObtained}/${point.maxMarks} on ${formatDate(point.date)}`,
                          }))}
                          emptyMessage="Two tests are needed before a trend means anything."
                        />
                      </ChartFigure>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Every test</CardTitle>
                <CardDescription>Newest first.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Test</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead className="w-28">Date</TableHead>
                        <TableHead className="w-24 text-right">Marks</TableHead>
                        <TableHead className="w-20 text-right">Percent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="font-medium">{entry.name}</TableCell>
                          <TableCell>{entry.subject}</TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {formatDate(entry.date)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.sat ? (
                              `${entry.marksObtained}/${entry.maxMarks}`
                            ) : (
                              <span className="text-muted-foreground">Not sat</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.share === null ? "—" : `${Math.round(entry.share * 100)}%`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
