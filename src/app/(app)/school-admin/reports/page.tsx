import { BarChart3Icon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { PrintButton } from "@/components/shared/print-button";
import { SetupNotice } from "@/components/shared/setup-notice";
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
import { formatDate, parseDateInput, today, toDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { peopleSummary } from "@/server/people/lifecycle";
import { supportSummary } from "@/server/support/service";
import { getT } from "@/server/i18n";
import { EMPLOYEE_LIFECYCLE, STUDENT_LIFECYCLE } from "@/lib/validation/lifecycle";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { schoolReport, sectionReport } from "@/server/attendance/service";
import { classStrengthReport, examPerformanceReport, staffAttendanceReport, teacherWorkloadReport } from "@/server/reports/exports";

export const metadata: Metadata = { title: "Reports" };

/** Below this, a student is flagged for follow-up. */
const LOW_ATTENDANCE = 0.75;

function Share({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("font-medium tabular-nums", value < LOW_ATTENDANCE && "text-danger-strong")}>
      {Math.round(value * 100)}%
    </span>
  );
}

function Bar({ value }: { value: number | null }) {
  return (
    <div className="bg-muted h-2 w-full min-w-16 overflow-hidden rounded-full" aria-hidden>
      <div
        className={cn("h-full rounded-full", value !== null && value < LOW_ATTENDANCE ? "bg-danger" : "bg-primary")}
        style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
      />
    </div>
  );
}

export default async function ReportsPage(props: PageProps<"/school-admin/reports">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);

  if (!session) {
    return (
      <>
        <SetupNotice title="Reports" need="session" />
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
      <PageHeader icon={BarChart3Icon} tone="blue"
        title="Reports"
        description={`${formatDate(from)} – ${formatDate(to)} · students below ${LOW_ATTENDANCE * 100}% are shown in red.`}
        actions={
          <>
            <PrintButton />
            {sectionId ? (
              <Button asChild variant="outline">
                <Link href={`/school-admin/reports/export?section=${sectionId}&from=${range.from}&to=${range.to}`} prefetch={false}>
                  Download CSV
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar
        action="/school-admin/reports"
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
        <>
          <SchoolReport ctx={ctx} sessionId={session.id} from={from} to={to} range={range} />
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <PeopleReport ctx={ctx} />
            <SupportReport ctx={ctx} />
            <ClassStrength ctx={ctx} />
            <StaffAttendance ctx={ctx} from={from} to={to} range={range} />
            <ExamPerformance ctx={ctx} />
            <TeacherWorkload ctx={ctx} from={from} to={to} />
          </div>
        </>
      )}

      <Downloads range={range} />
    </>
  );
}

/** "Which students need support, and what is the school doing about it?" */
async function SupportReport({ ctx }: { ctx: Awaited<ReturnType<typeof requireTenant>> }) {
  const [t, summary] = await Promise.all([getT(), supportSummary(ctx)]);
  const figures: Array<[string, number]> = [
    [t("support.needsAttention"), summary.students],
    [t("support.inProgress"), (summary.byStatus.IN_PROGRESS ?? 0) + (summary.byStatus.SUPPORT_PLANNED ?? 0)],
    [t("support.improving"), summary.byStatus.IMPROVING ?? 0],
    [t("support.resolved"), summary.byStatus.RESOLVED ?? 0],
    [t("support.fromParents"), summary.bySource.PARENT ?? 0],
  ];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{t("support.reportTitle")}</CardTitle>
          <CardDescription>{t("support.reportHint")}</CardDescription>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/school-admin/support">{t("support.openReport")}</Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {figures.map(([label, value]) => (
            <div key={label} className="bg-muted/50 rounded-xl p-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-xl font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {summary.bySubject.length ? (
          <ul className="flex flex-wrap gap-2 text-sm">
            {summary.bySubject.map((row) => (
              <li key={row.subject ?? "general"} className="bg-primary-soft text-primary-strong rounded-full px-3 py-1">
                {row.subject ?? t("support.general")} · {row.count}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Current and former people, never mixed: "active students" means current ones only. */
async function PeopleReport({ ctx }: { ctx: Awaited<ReturnType<typeof requireTenant>> }) {
  const summary = await peopleSummary(ctx);
  const groups = [
    { key: "students", title: "Students", formerLabel: "Left the school", data: summary.students, order: STUDENT_LIFECYCLE },
    { key: "teachers", title: "Teachers", formerLabel: "Former teachers", data: summary.teachers, order: EMPLOYEE_LIFECYCLE },
    { key: "staff", title: "Non-teaching staff", formerLabel: "Former staff", data: summary.staff, order: EMPLOYEE_LIFECYCLE },
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
        <CardDescription>Current people and those who have left, counted separately. Every record is kept.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group.key}>
            <p className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="font-semibold">{group.title}</span>
              <span>
                Current <span className="font-semibold tabular-nums">{group.data.current}</span>
              </span>
              <span className="text-muted-foreground">
                {group.formerLabel} <span className="tabular-nums">{group.data.former}</span>
              </span>
            </p>
            <ul className="flex flex-wrap gap-2">
              {group.order
                .filter((status) => group.data.byStatus[status])
                .map((status) => (
                  <li key={status} className="flex items-center gap-1.5 text-xs">
                    <StatusBadge status={status} />
                    <span className="tabular-nums">{group.data.byStatus[status]}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const DOWNLOADS: Array<{ kind: string; label: string; hint: string; ranged?: boolean }> = [
  { kind: "students", label: "Student list", hint: "Class, section, roll, gender and guardian, this session" },
  { kind: "teachers", label: "Teacher list", hint: "Contact, status and subject assignments" },
  { kind: "class-strength", label: "Class strength", hint: "Boys and girls per class" },
  { kind: "staff-attendance", label: "Staff attendance", hint: "Teachers and all other staff, for the dates above", ranged: true },
  { kind: "exam-performance", label: "Exam performance", hint: "Average and pass rate per exam" },
  { kind: "teacher-workload", label: "Teacher workload", hint: "Periods, cover, missed classes and leave for the dates above", ranged: true },
  { kind: "fees", label: "Fee positions", hint: "Every student's total, paid and pending" },
  { kind: "fees-pending", label: "Pending fees", hint: "Only students who still owe" },
  { kind: "fee-payments", label: "Fee receipts", hint: "Every receipt in the dates above, void ones marked", ranged: true },
  { kind: "expenses", label: "Expenses", hint: "What was spent in the dates above, by category", ranged: true },
  { kind: "salary-payments", label: "Salary payments", hint: "Salaries paid in the dates above", ranged: true },
  { kind: "substitutes", label: "Substitute & missed classes", hint: "Who took whose class, and what was missed", ranged: true },
  { kind: "homework", label: "Homework set", hint: "By class, subject and teacher for the dates above", ranged: true },
  { kind: "support", label: "Student support", hint: "Support records this session (staff only)" },
];

function Downloads({ range }: { range: { from: string; to: string } }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Downloads</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {DOWNLOADS.map((item) => (
            <li key={item.kind} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span className="min-w-0 text-sm">
                <span className="block font-medium">{item.label}</span>
                <span className="text-muted-foreground block text-xs">{item.hint}</span>
              </span>
              <Button asChild size="sm" variant="outline">
                <Link
                  href={
                    `/school-admin/reports/export?kind=${item.kind}${item.ranged ? `&from=${range.from}&to=${range.to}` : ""}` as Route
                  }
                  prefetch={false}
                >
                  CSV
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

async function ClassStrength({ ctx }: { ctx: Awaited<ReturnType<typeof requireTenant>> }) {
  const { rows, totals } = await classStrengthReport(ctx);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Class strength</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Boys</TableHead>
                <TableHead className="text-right">Girls</TableHead>
                <TableHead className="text-right">Other</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.boys}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.girls}</TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">{row.other}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{row.total}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{totals.boys}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{totals.girls}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{totals.other}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{totals.total}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No students placed this session" />
        )}
      </CardContent>
    </Card>
  );
}

async function StaffAttendance({
  ctx,
  from,
  to,
}: {
  ctx: Awaited<ReturnType<typeof requireTenant>>;
  from: Date;
  to: Date;
  range: { from: string; to: string };
}) {
  const rows = await staffAttendanceReport(ctx, from, to);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff attendance</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Present</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Absent</TableHead>
                <TableHead className="text-right">Leave</TableHead>
                <TableHead className="text-right">Attended</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {row.job} · {row.employeeId}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.counts.PRESENT}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.counts.LATE}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.counts.ABSENT}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.counts.ON_LEAVE}</TableCell>
                  <TableCell className="text-right">
                    <Share value={row.share} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No staff yet" />
        )}
      </CardContent>
    </Card>
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
                  href={`/school-admin/reports?section=${row.id}&from=${range.from}&to=${range.to}`}
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
                  <Link href={`/school-admin/students/${student.studentId}`} className="font-medium hover:underline">
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

async function ExamPerformance({ ctx }: { ctx: Awaited<ReturnType<typeof requireTenant>> }) {
  const { exams, subjects } = await examPerformanceReport(ctx);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exam performance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {exams.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Exam</TableHead>
                <TableHead className="text-right">Students</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right">Pass</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell>
                    <span className="font-medium">{exam.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {exam.section} · {exam.status === "PUBLISHED" ? "published" : "draft"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{exam.students}</TableCell>
                  <TableCell className="text-right tabular-nums">{exam.average === null ? "—" : `${exam.average}%`}</TableCell>
                  <TableCell className="text-right">
                    <Share value={exam.passRate} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No exams this session" />
        )}
        {subjects.length ? (
          <p className="text-muted-foreground text-xs">
            Weakest subjects by average: {subjects.slice(0, 3).map((row) => `${row.subject} ${row.average}%`).join(", ")}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function TeacherWorkload({ ctx, from, to }: { ctx: Awaited<ReturnType<typeof requireTenant>>; from: Date; to: Date }) {
  const rows = await teacherWorkloadReport(ctx, from, to);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Teacher workload</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teacher</TableHead>
                <TableHead className="text-right">Periods/wk</TableHead>
                <TableHead className="text-right">Written up</TableHead>
                <TableHead className="text-right">Missed</TableHead>
                <TableHead className="text-right">Covered</TableHead>
                <TableHead className="text-right">Leave</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {row.sections} sections · {row.subjects} subjects{row.classTeacher ? " · class teacher" : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.periodsPerWeek}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.completed}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.missed}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.coveredForOthers}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.leaveDays}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No teachers yet" />
        )}
      </CardContent>
    </Card>
  );
}
