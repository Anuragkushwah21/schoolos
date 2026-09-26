import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChildTabs } from "@/features/parent/child-nav";
import { formatDate } from "@/lib/dates";
import { formatPercent, humanize, pluralize } from "@/lib/format";
import { enumParam } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { REPORT_PERIODS, getChildReport } from "@/server/parent/child";

export const metadata: Metadata = { title: "Reports" };

const PERIOD_LABEL = { day: "Today", week: "This week", month: "This month" } as const;

/**
 * A summary nobody had to write.
 *
 * Assembled from the same rows the school runs on — the register, each period's
 * write-up, the homework set, the marks entered, the remarks saved. No teacher
 * fills in a report for a parent, and because nothing is copied, this cannot
 * disagree with the register it came from.
 *
 * On-screen only for now. The shape is the one a PDF or a scheduled email would
 * render, so adding either later does not need this rewritten.
 */
export default async function ChildReportPage(
  props: PageProps<"/parent/children/[studentId]/reports">,
) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const search = await props.searchParams;
  const period = enumParam(search.period, REPORT_PERIODS) ?? "week";

  const report = await orNotFound(getChildReport(ctx, studentId, period));
  const { child, attendance, lessons } = report;

  const nothing =
    attendance.counts.total === 0 &&
    lessons.total === 0 &&
    report.homework.length === 0 &&
    report.results.length === 0 &&
    report.remarks.length === 0;

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={`${child.student.name} — report`}
        description={`${formatDate(report.from)} to ${formatDate(report.to)} · ${child.placement.sectionLabel}`}
        actions={
          <div className="flex gap-2">
            {REPORT_PERIODS.map((option) => (
              <Button
                key={option}
                asChild
                size="sm"
                variant={option === period ? "default" : "outline"}
              >
                <Link href={`/parent/children/${studentId}/reports?period=${option}` as Route}>
                  {PERIOD_LABEL[option]}
                </Link>
              </Button>
            ))}
          </div>
        }
      />
      <ChildTabs studentId={studentId} active="reports" />

      {nothing ? (
        <EmptyState title={`Nothing recorded in this ${period}`}>
          A report is built from what the school recorded. Try a longer period, or check back once
          more of the week has happened.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Attended"
              value={
                attendance.share === null
                  ? "—"
                  : formatPercent(
                      attendance.counts.PRESENT + attendance.counts.LATE,
                      attendance.counts.total,
                    )
              }
              hint={`${attendance.counts.total} days marked`}
            />
            <StatCard label="Classes held" value={lessons.completed} hint={`of ${lessons.total} written up`} />
            <StatCard label="Homework set" value={report.homework.length} />
            <StatCard label="Tests" value={report.results.length} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>What was taught</CardTitle>
              <CardDescription>
                {lessons.total
                  ? `${pluralize(lessons.total, "period")} written up${lessons.substitute ? `, ${lessons.substitute} covered` : ""}${lessons.missed ? `, ${lessons.missed} missed` : ""}.`
                  : "No periods written up in this period."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lessons.bySubject.length ? (
                <ul className="divide-y">
                  {lessons.bySubject.map((subject) => (
                    <li key={subject.subject} className="py-2.5">
                      <p className="text-sm font-medium">
                        {subject.subject}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {pluralize(subject.periods, "period")}
                        </span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {subject.topics.length ? subject.topics.join(" · ") : "No topics recorded"}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing written up yet.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Attendance, day by day</CardTitle>
              </CardHeader>
              <CardContent>
                {attendance.rows.length ? (
                  <ul className="divide-y">
                    {attendance.rows.map((row) => (
                      <li
                        key={row.date.toISOString()}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="text-sm tabular-nums">{formatDate(row.date)}</span>
                        <span className="flex items-center gap-2">
                          {row.remarks ? (
                            <span className="text-muted-foreground text-xs">{row.remarks}</span>
                          ) : null}
                          <StatusBadge status={row.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No register taken in this period.</p>
                )}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Homework set</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.homework.length ? (
                    <ul className="divide-y">
                      {report.homework.map((work) => (
                        <li key={work.id} className="flex items-baseline justify-between gap-3 py-2">
                          <span className="min-w-0 text-sm">
                            <span className="font-medium">{work.subject.name}</span> — {work.title}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            due {formatDate(work.dueOn)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">None set in this period.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tests</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.results.length ? (
                    <ul className="divide-y">
                      {report.results.map((result) => (
                        <li key={result.id} className="flex items-baseline justify-between gap-3 py-2">
                          <span className="min-w-0 text-sm">
                            <span className="font-medium">{result.subject}</span> — {result.name}
                          </span>
                          <span className="shrink-0 text-sm tabular-nums">
                            {result.marksObtained === null
                              ? "Not sat"
                              : `${result.marksObtained}/${result.maxMarks}`}
                            {result.share === null ? "" : ` · ${Math.round(result.share * 100)}%`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">None in this period.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Teacher remarks</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.remarks.length ? (
                    <ul className="divide-y">
                      {report.remarks.map((remark) => (
                        <li key={remark.id} className="flex flex-col gap-1.5 py-2.5">
                          <span className="flex flex-wrap gap-1">
                            {remark.understanding ? (
                              <StatusBadge
                                status={remark.understanding}
                                label={humanize(remark.understanding)}
                              />
                            ) : null}
                            {remark.participation ? (
                              <StatusBadge
                                status={remark.participation}
                                label={humanize(remark.participation)}
                              />
                            ) : null}
                          </span>
                          {remark.note ? <span className="text-sm">{remark.note}</span> : null}
                          <span className="text-muted-foreground text-xs">
                            {remark.author} · {formatDate(remark.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">None in this period.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
