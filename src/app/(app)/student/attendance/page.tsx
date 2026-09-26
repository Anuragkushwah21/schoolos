import type { Metadata } from "next";

import { BarChart } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttendanceHistory } from "@/features/attendance/history";
import { StudentTabs } from "@/features/student/nav";
import { formatPercent } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyAttendance } from "@/server/student/me";

export const metadata: Metadata = { title: "Attendance" };

/** The student's own register. Read-only — a student cannot change a mark. */
export default async function StudentAttendancePage() {
  const ctx = await requireTenant("STUDENT");
  const data = await orNotFound(getMyAttendance(ctx));
  const { me, counts, share } = data;

  return (
    <>
      <PageHeader
        title="My attendance"
        description={`${me.placement.sectionLabel} · ${me.placement.sessionName}`}
      />
      <StudentTabs active="attendance" />

      {data.low && share !== null ? (
        <div
          role="status"
          className="mb-6 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--viz-warning)", color: "var(--viz-warning)" }}
        >
          Your attendance is {Math.round(share * 100)}%, below the{" "}
          {Math.round(data.threshold * 100)}% the school looks for.
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
        <EmptyState title="No register taken yet">
          Your attendance appears here once your teachers start marking it.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <ChartFigure
                title="Month by month"
                subtitle="Share of marked days attended. Present and late both count as attended."
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
