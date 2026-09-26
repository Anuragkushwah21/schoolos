import type { Metadata } from "next";

import { BarChart } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { TrendArea } from "@/components/charts/trend-area";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttendanceHistory } from "@/features/attendance/history";
import { ChildTabs } from "@/features/parent/child-nav";
import { formatDayShort } from "@/lib/dates";
import { formatPercent } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getChildAttendance } from "@/server/parent/child";

export const metadata: Metadata = { title: "Attendance" };

/**
 * One child's register, as their school marked it.
 *
 * Read-only: there is no guardian-facing writer in `src/server/parent/`, and
 * `markAttendance` asserts TEACHER or SCHOOL_ADMIN, so there is nothing here a
 * forged request could reach.
 */
export default async function ChildAttendancePage(
  props: PageProps<"/parent/children/[studentId]/attendance">,
) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const data = await orNotFound(getChildAttendance(ctx, studentId));
  const { child, counts, share } = data;

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={`${child.student.name} — attendance`}
        description={`${child.placement.sectionLabel} · ${child.placement.sessionName}`}
      />
      <ChildTabs studentId={studentId} active="attendance" />

      {data.low && share !== null ? (
        <div
          role="status"
          className="mb-6 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--viz-warning)", color: "var(--viz-warning)" }}
        >
          Attendance is {Math.round(share * 100)}%, below the{" "}
          {Math.round(data.threshold * 100)}% the school looks for. {counts.ABSENT} of{" "}
          {counts.total} marked days were absences.
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Attended"
          value={share === null ? "—" : formatPercent(counts.PRESENT + counts.LATE, counts.total)}
          hint={`${counts.total} days marked`}
        />
        <StatCard label="Present" value={counts.PRESENT} />
        <StatCard label="Absent" value={counts.ABSENT} />
        <StatCard label="Late" value={counts.LATE} />
        <StatCard label="Excused" value={counts.EXCUSED} />
      </div>

      {counts.total === 0 ? (
        <EmptyState title="No register has been taken yet">
          Attendance appears here as soon as {child.student.name.split(" ")[0]}&apos;s teachers start
          marking it.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <ChartFigure
                title="Month by month"
                subtitle="Share of marked days attended, present and late counted together."
                table={{
                  head: ["Month", "Attended", "Present", "Late", "Excused", "Absent", "Marked"],
                  rows: data.months.map((month) => [
                    month.fullLabel,
                    month.share === null ? "—" : `${Math.round(month.share * 100)}%`,
                    month.counts.PRESENT,
                    month.counts.LATE,
                    month.counts.EXCUSED,
                    month.counts.ABSENT,
                    month.counts.total,
                  ]),
                }}
              >
                <BarChart
                  data={data.months.map((month) => ({
                    key: month.key,
                    label: month.label,
                    value: month.share === null ? 0 : Math.round(month.share * 100),
                    detail: `${month.counts.PRESENT + month.counts.LATE} of ${month.counts.total} days`,
                  }))}
                  formatValue={(value) => `${value}%`}
                  emptyMessage="Nothing marked yet."
                />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <ChartFigure
                title="Recent trend"
                subtitle="The last month of marked days. A gap is a day with no register, not a zero."
                table={{
                  head: ["Day", "Status"],
                  rows: [...data.trend]
                    .reverse()
                    .slice(0, 12)
                    .map((point) => [formatDayShort(point.date), point.status]),
                }}
              >
                <TrendArea
                  data={data.trend.map((point) => ({
                    key: point.date.toISOString(),
                    label: formatDayShort(point.date),
                    value: point.status === "PRESENT" || point.status === "LATE" ? 100 : 0,
                    detail: point.status,
                  }))}
                  emptyMessage="Not enough marked days to draw a trend."
                />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Every marked day</CardTitle>
            </CardHeader>
            <CardContent>
              <AttendanceHistory rows={data.rows} />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
