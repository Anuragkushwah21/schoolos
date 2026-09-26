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
import { StudentTabs } from "@/features/student/nav";
import { formatDate } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyResults } from "@/server/student/me";

export const metadata: Metadata = { title: "Tests & results" };

const DIRECTION = { up: "Improving", down: "Slipping", flat: "Steady" } as const;

/**
 * Tests coming up, tests already sat, and how it is going.
 *
 * Percentages are computed from the mark and the paper's total rather than
 * stored. A trend is only claimed once there are two results in a subject — one
 * mark is a point, and drawing a direction from it would be invention.
 */
export default async function StudentResultsPage() {
  const ctx = await requireTenant("STUDENT");
  const { me, upcoming, past, progress } = await orNotFound(getMyResults(ctx));

  const sat = past.filter((entry) => entry.sat);
  const overall = sat.length
    ? sat.reduce((sum, entry) => sum + (entry.share ?? 0), 0) / sat.length
    : null;

  return (
    <>
      <PageHeader
        title="Tests & results"
        description={`${me.placement.sectionLabel} · ${me.placement.sessionName}`}
      />
      <StudentTabs active="results" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Average"
          value={overall === null ? "—" : `${Math.round(overall * 100)}%`}
          hint={`across ${pluralize(sat.length, "test")}`}
        />
        <StatCard label="Tests sat" value={sat.length} />
        <StatCard label="Coming up" value={upcoming.length} />
        <StatCard label="Subjects" value={progress.length} />
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
            <CardDescription>Soonest first — what to prepare for.</CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length ? (
              <ul className="divide-y">
                {upcoming.map((test) => (
                  <li key={test.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{test.subject}</span> — {test.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {formatDate(test.date)} · out of {test.maxMarks}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No tests scheduled at the moment.</p>
            )}
          </CardContent>
        </Card>

        {progress.length ? (
          <div className="grid gap-6 xl:grid-cols-2">
            {progress.map((subject) => {
              const points = past
                .filter((entry) => entry.subjectId === subject.subjectId && entry.sat)
                .reverse();
              return (
                <Card key={subject.subjectId}>
                  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle>{subject.subject}</CardTitle>
                      <CardDescription>
                        {subject.average === null
                          ? "Not enough marks yet"
                          : `Averaging ${Math.round(subject.average * 100)}% over ${pluralize(subject.count, "test")}`}
                      </CardDescription>
                    </div>
                    {subject.direction ? (
                      <StatusBadge
                        status={
                          subject.direction === "up"
                            ? "ACTIVE"
                            : subject.direction === "down"
                              ? "NEEDS_ATTENTION"
                              : "AVERAGE"
                        }
                        label={DIRECTION[subject.direction]}
                      />
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    <ChartFigure
                      title={`${subject.subject} over time`}
                      subtitle="Oldest test first."
                      table={{
                        head: ["Test", "Marks", "Percent"],
                        rows: points.map((point) => [
                          point.name,
                          `${point.marksObtained}/${point.maxMarks}`,
                          point.share === null ? "—" : `${Math.round(point.share * 100)}%`,
                        ]),
                      }}
                    >
                      <TrendArea
                        data={points.map((point) => ({
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
              );
            })}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Every test</CardTitle>
            <CardDescription>Newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {past.length ? (
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
                    {past.map((entry) => (
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
            ) : (
              <EmptyState title="No marks recorded yet">
                Results appear here once your teachers enter them.
              </EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
