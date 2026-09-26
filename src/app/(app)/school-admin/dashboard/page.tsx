import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import { ChartEmpty, ChartFigure } from "@/components/charts/chart-figure";
import { BarChart, Meter, StackedBar } from "@/components/charts/bars";
import { TrendArea } from "@/components/charts/trend-area";
import {
  ORDINAL_RAMP,
  attendanceLegend,
  attendanceSegments,
} from "@/components/charts/attendance-colors";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeList } from "@/features/communication/feed";
import { formatDate, formatDayShort } from "@/lib/dates";
import { formatPercent, pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { todayOverview } from "@/server/attendance/service";
import {
  admissionsFunnel,
  attendanceTrend,
  classStrength,
  genderSplit,
  registersOutstanding,
  studentsNeedingAttention,
} from "@/server/analytics/school";
import { noticesFor } from "@/server/communication/notices";

export const metadata: Metadata = { title: "School dashboard" };

const LOW_ATTENDANCE = 0.75;

export default async function AdminDashboardPage() {
  // Authorization and tenant scope in one step: `db` can only ever see this
  // administrator's own school.
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { db } = ctx;

  const session = await getCurrentSession(ctx);

  const [students, teachers, pendingAdmissions, notices, overview, gender] = await Promise.all([
    db.student.count({ where: { status: "ACTIVE" } }),
    db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
    db.admissionApplication.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    noticesFor(ctx, { take: 4 }),
    session ? todayOverview(ctx, session.id) : Promise.resolve(null),
    genderSplit(ctx),
  ]);

  const [trend, strength, funnel, attention, registers] = session
    ? await Promise.all([
        attendanceTrend(ctx, { academicSessionId: session.id, days: 30 }),
        classStrength(ctx, session.id),
        admissionsFunnel(ctx, session.id),
        studentsNeedingAttention(ctx, {
          academicSessionId: session.id,
          threshold: LOW_ATTENDANCE,
          limit: 6,
        }),
        registersOutstanding(ctx, session.id),
      ])
    : [[], [], null, [], []];

  const attendedToday = overview ? overview.counts.PRESENT + overview.counts.LATE : 0;
  const outstanding = registers.filter((row) => !row.marked);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          session
            ? `Academic session ${session.name} · ${formatDate(session.startDate)} – ${formatDate(session.endDate)}`
            : "No academic session is marked as current yet."
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/reports">Reports</Link>
            </Button>
            <Button asChild>
              <Link href="/admin/attendance">Mark attendance</Link>
            </Button>
          </>
        }
      />

      {!session ? (
        <EmptyState
          title="Set up your academic session"
          action={
            <Button asChild size="sm">
              <Link href="/admin/academics">Go to Academics</Link>
            </Button>
          }
        >
          Classes, sections, timetables and attendance all belong to a session.
        </EmptyState>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Students"
          value={students}
          hint={`${gender.boys} boys · ${gender.girls} girls`}
          href="/admin/students"
        />
        <StatCard label="Teachers" value={teachers} href="/admin/teachers" />
        <StatCard
          label="Present today"
          value={overview && overview.counts.total ? formatPercent(attendedToday, overview.counts.total) : "—"}
          hint={overview ? `${overview.counts.total} marked` : undefined}
          href="/admin/attendance"
        />
        <StatCard
          label="Registers marked"
          value={overview ? `${overview.sectionsMarked}/${overview.sections}` : "—"}
          hint={overview ? formatDayShort(overview.date) : undefined}
          href="/admin/attendance"
        />
        <StatCard label="Pending admissions" value={pendingAdmissions} href="/admin/admissions" />
      </div>

      {outstanding.length ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="flex items-center gap-2">
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
            {pluralize(outstanding.length, "register")} not marked today:{" "}
            {outstanding
              .slice(0, 3)
              .map((row) => row.label)
              .join(", ")}
            {outstanding.length > 3 ? ` and ${outstanding.length - 3} more` : ""}.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/attendance">Open registers</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <div className="flex flex-col gap-6">
          {/* ---------------- attendance over the month ---------------- */}
          <Card>
            <CardContent>
              <ChartFigure
                title="Attendance, last 30 days"
                subtitle="Present and late, over every student marked that day. Days with no register are left out."
                table={{
                  head: ["Day", "Attended", "Present", "Late", "Excused", "Absent"],
                  rows: trend
                    .filter((point) => point.counts.total > 0)
                    .slice(-14)
                    .reverse()
                    .map((point) => [
                      point.label,
                      point.share === null ? "—" : `${Math.round(point.share * 100)}%`,
                      point.counts.PRESENT,
                      point.counts.LATE,
                      point.counts.EXCUSED,
                      point.counts.ABSENT,
                    ]),
                }}
              >
                <TrendArea
                  data={trend.map((point) => ({
                    key: point.key,
                    label: point.label,
                    value: point.share === null ? null : Math.round(point.share * 100),
                    detail:
                      point.counts.total > 0
                        ? `${point.counts.PRESENT + point.counts.LATE} of ${point.counts.total} students`
                        : undefined,
                  }))}
                  emptyMessage="Mark a few registers and the trend will appear here."
                />
              </ChartFigure>
            </CardContent>
          </Card>

          {/* ---------------- today's register ---------------- */}
          <Card>
            <CardContent>
              <ChartFigure
                title={`Today's register · ${overview ? formatDayShort(overview.date) : ""}`}
                subtitle={
                  overview && overview.counts.total
                    ? `${overview.counts.total} students marked across ${overview.sectionsMarked} of ${overview.sections} sections.`
                    : "Nothing marked yet today."
                }
                legend={overview ? attendanceLegend(overview.counts) : []}
                table={
                  overview
                    ? {
                        head: ["Status", "Students"],
                        rows: attendanceSegments(overview.counts).map((segment) => [
                          segment.label,
                          segment.value,
                        ]),
                      }
                    : undefined
                }
              >
                {overview ? (
                  <StackedBar segments={attendanceSegments(overview.counts)} />
                ) : (
                  <ChartEmpty>No academic session yet.</ChartEmpty>
                )}
              </ChartFigure>

              {overview && overview.sections > 0 ? (
                <div className="mt-6 flex flex-col gap-4">
                  <Meter
                    label="Registers marked today"
                    value={overview.sectionsMarked}
                    max={overview.sections}
                    tone={overview.sectionsMarked === overview.sections ? "good" : "warning"}
                  />
                  {overview.staffMarked > 0 ? (
                    <Meter
                      label="Staff present today"
                      value={overview.staffPresent}
                      max={overview.staffMarked}
                      tone="good"
                    />
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* ---------------- class strength ---------------- */}
          <Card>
            <CardContent>
              <ChartFigure
                title="Students per class"
                subtitle={session ? `Active enrolments in ${session.name}.` : undefined}
                table={{
                  head: ["Class", "Students"],
                  rows: strength.map((row) => [row.label, row.value]),
                }}
              >
                <BarChart
                  data={strength.map((row) => ({ key: row.id, label: row.label, value: row.value }))}
                  labelWidth={96}
                  emptyMessage="No students placed in this session yet."
                />
              </ChartFigure>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {/* ---------------- students needing attention ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>
                Students below {LOW_ATTENDANCE * 100}% attendance this session, lowest first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {attention.length ? (
                <ul className="divide-y">
                  {attention.map((student) => (
                    <li key={student.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/students/${student.id}`}
                          className="font-medium hover:underline"
                        >
                          {student.name}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          {student.section ?? "Not placed"}
                          {student.rollNumber ? ` · roll ${student.rollNumber}` : ""}
                        </p>
                      </div>
                      <span
                        className="text-sm font-medium tabular-nums"
                        style={{ color: "var(--viz-critical)" }}
                      >
                        {Math.round((student.share ?? 0) * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <CheckIcon className="size-4 shrink-0" style={{ color: "var(--viz-good)" }} aria-hidden />
                  Nobody is below {LOW_ATTENDANCE * 100}% so far.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---------------- admissions funnel ---------------- */}
          <Card>
            <CardContent>
              <ChartFigure
                title="Admissions this session"
                subtitle={
                  funnel
                    ? `${funnel.received} received · ${funnel.waiting} awaiting a decision · ${funnel.rejected} rejected`
                    : undefined
                }
                table={
                  funnel
                    ? {
                        head: ["Stage", "Applications"],
                        rows: funnel.stages.map((stage) => [stage.label, stage.value]),
                      }
                    : undefined
                }
              >
                <BarChart
                  data={(funnel?.received ? funnel.stages : []).map((stage, index) => ({
                    key: stage.key,
                    label: stage.label,
                    value: stage.value,
                    // Ordered stages, so an ordinal ramp rather than category colours.
                    color: ORDINAL_RAMP[index],
                  }))}
                  labelWidth={86}
                  width={380}
                  emptyMessage="No applications yet this session."
                />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Notices</CardTitle>
                <CardDescription>What your school is announcing.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/notices">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <NoticeList notices={notices} compact showAudience />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Registers today</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/attendance">Open</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {registers.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {registers.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">{row.label}</span>
                      {row.marked ? (
                        <StatusBadge status="ACTIVE" label="Marked" />
                      ) : (
                        <Button asChild size="xs" variant="outline">
                          <Link href={`/admin/attendance?section=${row.id}`}>Mark</Link>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No sections with students yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
