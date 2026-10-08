import type { Metadata, Route } from "next";
import Link from "next/link";
import {
  BarChart3Icon,
  BookOpenCheckIcon,
  CalendarClockIcon,
  CalendarOffIcon,
  CalendarPlusIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  FilePenLineIcon,
  GraduationCapIcon,
  HandshakeIcon,
  HeartPulseIcon,
  MegaphoneIcon,
  PartyPopperIcon,
  SchoolIcon,
  TrendingUpIcon,
  UserCheckIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { QuickActions } from "@/components/shared/quick-actions";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SchoolLifeCards } from "@/features/dashboard/school-life";
import { rupees } from "@/features/finance/money";
import { AlertList } from "@/features/parent/today";
import { attendedDays } from "@/lib/attendance";
import { formatDate, formatDayShort } from "@/lib/dates";
import { greetingKey } from "@/lib/greeting";
import { cn } from "@/lib/utils";
import { getCurrentSession } from "@/server/academics/structure";
import { academicSnapshot, financeSnapshot, staffToday, studentBands } from "@/server/analytics/admin-dashboard";
import { getPrincipalAlerts } from "@/server/alerts/feeds";
import { todayOverview } from "@/server/attendance/service";
import { requireTenant } from "@/server/auth/current-user";
import { getIntlLocale, getT } from "@/server/i18n";
import { hasModule } from "@/server/platform/modules";
import { classPerformance, principalInsights } from "@/server/principal/overview";
import { responsibilitySummary } from "@/server/responsibilities/service";

export const metadata: Metadata = { title: "Principal dashboard" };

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const share = (part: number, total: number) => (total ? `${part} / ${total}` : "—");

function Section({ title, description, href, linkLabel, children }: { title: string; description?: string; href?: Route; linkLabel?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {href ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={href}>{linkLabel ?? "Open"}</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Figure({ label, value, warn = false }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="bg-muted/40 rounded-xl px-3 py-2.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", warn && "text-danger-strong")}>{value}</p>
    </div>
  );
}

/**
 * The Principal's home — a working school leader's dashboard: the school at a
 * glance, academics, teachers, exams, attendance, responsibilities and
 * communication, with the everyday actions one tap away. Every figure is this
 * school's; every action opens a page whose server checks the Principal's
 * permission again.
 */
export default async function PrincipalDashboardPage() {
  const ctx = await requireTenant("PRINCIPAL");
  const [t, intl, session] = await Promise.all([getT(), getIntlLocale(), getCurrentSession(ctx)]);
  if (!session) return <SetupNotice title="Dashboard" need="session" />;

  const financeOn = await hasModule(ctx, "FINANCE");
  const [overview, bands, academic, staff, classes, insights, duties, money, alerts] = await Promise.all([
    todayOverview(ctx, session.id),
    studentBands(ctx, session.id),
    academicSnapshot(ctx, session.id),
    staffToday(ctx),
    classPerformance(ctx, session.id),
    principalInsights(ctx, session.id),
    responsibilitySummary(ctx),
    financeOn ? financeSnapshot(ctx, session.id) : Promise.resolve(null),
    getPrincipalAlerts(ctx),
  ]);
  const students = bands.reduce((sum, band) => sum + band.value, 0);
  const attended = attendedDays(overview.counts);
  const scored = classes.filter((row) => row.averageScore !== null);
  const progress = scored.length ? scored.reduce((sum, row) => sum + row.averageScore!, 0) / scored.length : null;
  const lowAttendance = classes.filter((row) => row.attendance !== null && row.attendance < 0.75).sort((a, b) => a.attendance! - b.attendance!);
  const watch = [...classes].filter((row) => row.attendance !== null || row.averageScore !== null).sort((a, b) => (a.averageScore ?? 1) - (b.averageScore ?? 1)).slice(0, 6);
  const trend = insights.trend.filter((day) => day.rate !== null);

  return (
    <>
      <PageHeader
        variant="hero"
        title={`${t(greetingKey(), { name: ctx.user.firstName })} 👋`}
        description={`${ctx.schoolName} · ${session.name} · ${formatDayShort(new Date(), intl)}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/school-admin/reports">Reports</Link>
          </Button>
        }
      />

      {/* H. Quick actions */}
      <QuickActions
        compact
        title="Quick actions"
        actions={[
          { href: "/school-admin/students/new", label: "Add Student", icon: UserPlusIcon, tone: "blue" },
          { href: "/school-admin/teachers/new", label: "Add Teacher", icon: UsersIcon, tone: "purple" },
          { href: "/school-admin/notices/new", label: "Create Notice", icon: MegaphoneIcon, tone: "amber" },
          { href: "/school-admin/meetings/new", label: "Organize PTM", icon: HandshakeIcon, tone: "cyan" },
          { href: "/school-admin/events/new", label: "Create Event", icon: PartyPopperIcon, tone: "green" },
          { href: "/school-admin/exams/new", label: "Schedule Exam", icon: CalendarPlusIcon, tone: "orange" },
          { href: "/school-admin/responsibilities", label: "Assign Responsibility", icon: ClipboardListIcon, tone: "purple" },
          { href: "/school-admin/leave", label: "Review Leave", icon: CalendarOffIcon, tone: "green" },
          { href: "/school-admin/exams/results", label: "Review Results", icon: FilePenLineIcon, tone: "red" },
          { href: "/school-admin/reports", label: "View Reports", icon: BarChart3Icon, tone: "blue" },
        ]}
      />

      {/* A. School overview */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard tone="blue" icon={GraduationCapIcon} label="Students" value={students} hint="this session" href="/school-admin/students" />
        <StatCard tone="purple" icon={UsersIcon} label="Teachers" value={staff.teachers} hint={`${staff.staff} other staff`} href="/school-admin/teachers" />
        <StatCard
          tone="green"
          icon={ClipboardCheckIcon}
          label="Attendance today"
          value={overview.counts.total ? `${Math.round((attended / overview.counts.total) * 100)}%` : "—"}
          hint={overview.closure ? overview.closure.label : overview.counts.total ? `${attended} of ${overview.counts.total} present` : "not marked yet"}
          href="/school-admin/attendance"
        />
        <StatCard
          tone="cyan"
          icon={UserCheckIcon}
          label="Teacher attendance"
          value={overview.staffMarked ? `${Math.round((overview.staffPresent / overview.staffMarked) * 100)}%` : "—"}
          hint={overview.staffMarked ? `${overview.staffPresent} of ${overview.staffMarked} in` : "not marked yet"}
          href="/school-admin/attendance/staff"
        />
        <StatCard tone="orange" icon={SchoolIcon} label="Classes" value={insights.classes} hint={`${insights.sections} sections`} href="/school-admin/academics" />
        {money ? (
          <StatCard tone="green" icon={TrendingUpIcon} label="Fees (overview)" value={rupees(money.collectedSessionMinor)} hint={`collected · ${rupees(money.pendingMinor)} pending`} />
        ) : (
          <StatCard tone="red" icon={HeartPulseIcon} label="Need attention" value={academic.needsAttention} hint="students, by the school's rule" href="/school-admin/exams" />
        )}
      </div>

      <div className="grid gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* B. Academic */}
          <Section title="Academics" description="Test averages over the last 60 days; lessons recorded over the last 30." href={"/principal/classes" as Route} linkLabel="All classes">
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Academic progress" value={pct(progress)} />
              <Figure label="Lessons taught" value={insights.lessons.due ? `${pct(insights.lessons.rate)}` : "—"} />
              <Figure label="Weak students" value={academic.needsAttention} warn={academic.needsAttention > 0} />
              <Figure label="Tests coming" value={academic.upcomingTests} />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Class performance</h3>
                {watch.length ? (
                  <ul className="divide-y text-sm">
                    {watch.map((row) => (
                      <li key={row.id} className="flex items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                        <span className={cn("tabular-nums", row.averageScore !== null && row.averageScore < 0.4 && "text-danger-strong font-semibold")}>{pct(row.averageScore)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">Appears once tests are marked.</p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Subject performance</h3>
                {insights.subjects.length ? (
                  <ul className="divide-y text-sm">
                    {insights.subjects.slice(0, 6).map((subject) => (
                      <li key={subject.id} className="flex items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{subject.name}</span>
                        <span className={cn("tabular-nums", subject.average < 0.4 && "text-danger-strong font-semibold")}>{pct(subject.average)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">Appears once tests are marked.</p>
                )}
              </div>
            </div>
          </Section>

          {/* D. Exams */}
          <Section title="Exams & results" description="Results publish only once every mark is in." href="/school-admin/exams" linkLabel="Exams">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Upcoming (14 days)" value={academic.upcomingExams} />
              <Figure label="In progress" value={academic.examsInProgress} />
              <Figure label="Marks pending" value={academic.pendingMarks} warn={academic.pendingMarks > 0} />
              <Figure label="Ready to publish" value={academic.readyToPublish} />
            </div>
            {academic.nextExam ? <p className="text-muted-foreground mt-3 text-sm">{`Next: ${academic.nextExam.name}, ${formatDate(academic.nextExam.startDate)}`}</p> : null}
          </Section>

          {/* E. Attendance */}
          <Section title="Attendance" description="Classes under 75% over 30 days, and students absent 3+ days this week." href="/school-admin/attendance" linkLabel="Attendance">
            {trend.length ? (
              <div className="mb-4 flex items-end gap-2" aria-label="Attendance over the last 7 days">
                {trend.map((day) => (
                  <div key={day.date.toISOString()} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs tabular-nums">{pct(day.rate)}</span>
                    <span className="bg-primary/80 w-full max-w-10 rounded-t-md" style={{ height: `${Math.max(6, Math.round((day.rate ?? 0) * 64))}px` }} />
                    <span className="text-muted-foreground text-[11px]">{formatDayShort(day.date, intl).split(",")[0]}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Low-attendance classes</h3>
                {lowAttendance.length ? (
                  <ul className="divide-y text-sm">
                    {lowAttendance.slice(0, 6).map((row) => (
                      <li key={row.id} className="flex items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                        <span className="text-danger-strong font-semibold tabular-nums">{pct(row.attendance)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No class is below 75%.</p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Repeated absence</h3>
                {insights.repeatedAbsence.length ? (
                  <ul className="divide-y text-sm">
                    {insights.repeatedAbsence.slice(0, 6).map((student) => (
                      <li key={student.id} className="flex items-center gap-3 py-2">
                        <Link href={`/school-admin/students/${student.id}` as Route} className="min-w-0 flex-1 truncate font-medium hover:underline">
                          {student.name}
                        </Link>
                        <span className="text-muted-foreground text-xs">{student.section ?? ""}</span>
                        <span className="text-danger-strong font-semibold tabular-nums">{`${student.days} days`}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No one absent 3 or more days this week.</p>
                )}
              </div>
            </div>
          </Section>

          {/* C. Teachers */}
          <Section title="Teachers" href="/school-admin/teachers" linkLabel="Teachers">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="In today" value={overview.staffMarked ? share(overview.staffPresent, overview.staffMarked) : "—"} />
              <Figure label="On leave today" value={staff.onLeave} />
              <Figure label="Class teachers" value={share(insights.classTeacherCoverage.covered, insights.classTeacherCoverage.total)} warn={insights.classTeacherCoverage.covered < insights.classTeacherCoverage.total} />
              <Figure label="Sections with subject teachers" value={share(insights.subjectTeacherCoverage.covered, insights.subjectTeacherCoverage.total)} warn={insights.subjectTeacherCoverage.covered < insights.subjectTeacherCoverage.total} />
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
              {insights.workload.teachersTimetabled ? `Workload: ${insights.workload.averagePeriods.toFixed(1)} periods a week on average, ${insights.workload.maxPeriods} at most.` : "Workload appears once the timetable is set."}
            </p>
          </Section>
        </div>

        <aside aria-label="What needs a look, responsibilities and school updates" className="order-first flex min-w-0 flex-col gap-6 xl:order-none">
          <Card>
            <CardHeader>
              <CardTitle>Worth a look</CardTitle>
            </CardHeader>
            <CardContent>
              <AlertList alerts={alerts} emptyText="Nothing needs a look today." />
            </CardContent>
          </Card>

          {/* F. Responsibilities */}
          <Section title="Responsibilities" href="/school-admin/responsibilities" linkLabel="Open">
            <div className="grid grid-cols-2 gap-2">
              <Figure label="Given to me" value={duties.mine.pending + duties.mine.overdue} />
              <Figure label="Given by me" value={duties.assigned.pending + duties.assigned.overdue} />
              <Figure label="Pending" value={duties.all.pending} />
              <Figure label="Overdue" value={duties.all.overdue} warn={duties.all.overdue > 0} />
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
              {`${duties.all.recentlyCompleted} completed in the last 30 days`}
              {duties.all.awaitingReview ? ` · ${duties.all.awaitingReview} waiting for your review` : ""}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/school-admin/responsibilities">
                <BookOpenCheckIcon className="size-4" aria-hidden />
                Assign a responsibility
              </Link>
            </Button>
          </Section>

          {/* G. Communication */}
          <SchoolLifeCards ctx={ctx} base="/school-admin" narrow />
          <Button asChild variant="ghost" size="sm" className="-mt-6 self-start">
            <Link href="/school-admin/holidays">
              <CalendarClockIcon className="size-4" aria-hidden />
              School calendar
            </Link>
          </Button>
        </aside>
      </div>
    </>
  );
}
