import type { Metadata, Route } from "next";
import Link from "next/link";
import {
  BookOpenCheckIcon,
  CalendarCheckIcon,
  HourglassIcon,
  WalletIcon,
  Building2Icon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  PauseCircleIcon,
  UsersIcon,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, formatDate, formatDateTime, today } from "@/lib/dates";
import { formatMoney, formatNumber, humanize, pluralize } from "@/lib/format";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { activeSessionCount, moduleAdoption, platformTotals, recentRegistrations, schoolGrowth, schoolsByStatus } from "@/server/analytics/platform";
import { BarChart, ColumnChart } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { OPTIONAL_MODULES } from "@/lib/school-modules";
import { cn } from "@/lib/utils";
import { prisma } from "@/server/db/prisma";
import { PLATFORM_AUDIT_WHERE } from "@/server/platform/audit";
import { membershipOverview, platformCalendarEntries, platformReminders } from "@/server/platform/calendar";
import { collectionSummary } from "@/server/platform/collections";

export const metadata: Metadata = { title: "Platform" };

/**
 * The Super Admin's home: the platform at a glance — schools first, people
 * second — the latest registrations with what to do about each, and recent
 * platform actions. Charts and trends are on Platform Reports; a school's
 * daily work is never here.
 */
export default async function PlatformDashboardPage() {
  const user = await requireSuperAdmin();
  const [status, totals, sessions, recent, activity, growth, adoption, unverified, newEnquiries, endingSoon, reminders, membership, collection] = await Promise.all([
    schoolsByStatus(user),
    platformTotals(user),
    activeSessionCount(user),
    recentRegistrations(user, 8),
    prisma.auditLog.findMany({
      // Platform events only; a school's daily operations are not shown here.
      where: PLATFORM_AUDIT_WHERE,
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, action: true, summary: true, createdAt: true },
    }),
    schoolGrowth(user, 6),
    moduleAdoption(user),
    prisma.school.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] }, contactEmailVerifiedAt: null } }),
    prisma.platformInquiry.count({ where: { status: "NEW" } }),
    platformCalendarEntries(user, today(), addDays(today(), 7)),
    platformReminders(user),
    membershipOverview(user, 8),
    collectionSummary(user),
  ]);
  // Platform alerts: only what needs the Super Admin.
  const platformAlerts = [
    status.awaitingReview ? { text: `${status.awaitingReview} school${status.awaitingReview === 1 ? "" : "s"} waiting for approval`, href: "/super-admin/approvals" as Route, tone: "warning" } : null,
    unverified ? { text: `${unverified} pending school${unverified === 1 ? " has" : "s have"} not verified the contact email`, href: "/super-admin/approvals" as Route, tone: "info" } : null,
    status.suspended ? { text: `${status.suspended} school${status.suspended === 1 ? " is" : "s are"} suspended`, href: "/super-admin/schools?status=SUSPENDED" as Route, tone: "critical" } : null,
    reminders.overdue.length ? { text: `${reminders.overdue.length} subscription${reminders.overdue.length === 1 ? " is" : "s are"} overdue (ended or payment due)`, href: "/super-admin/calendar" as Route, tone: "critical" } : null,
    endingSoon.length ? { text: `${endingSoon.length} plan${endingSoon.length === 1 ? "" : "s"} or trial${endingSoon.length === 1 ? "" : "s"} ending in the next 7 days`, href: "/super-admin/calendar" as Route, tone: "warning" } : null,
    newEnquiries ? { text: `${newEnquiries} new enquir${newEnquiries === 1 ? "y" : "ies"} from schools`, href: "/super-admin/inquiries" as Route, tone: "info" } : null,
  ].filter((row): row is { text: string; href: Route; tone: string } => row !== null);

  return (
    <>
      <PageHeader
        variant="hero"
        title={`Hello, ${user.firstName} 👋`}
        description="Every school on SchoolOS, at a glance."
        actions={
          status.awaitingReview ? (
            <Button asChild variant="outline">
              <Link href="/super-admin/approvals">{`${status.awaitingReview} waiting for approval`}</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="blue" icon={Building2Icon} label="Total schools" value={status.total} hint="on the platform" href="/super-admin/schools" />
        <StatCard tone="green" icon={CheckCircle2Icon} label="Active schools" value={status.active} hint="using SchoolOS now" href="/super-admin/schools?status=ACTIVE" />
        <StatCard tone="amber" icon={ClipboardCheckIcon} label="Pending approval" value={status.awaitingReview} hint={status.awaitingReview ? "need a decision" : "all decided"} href="/super-admin/approvals" />
        <StatCard tone="red" icon={PauseCircleIcon} label="Suspended schools" value={status.suspended} hint="access paused" href="/super-admin/schools?status=SUSPENDED" />
      </div>

      {/* SchoolOS's own collection: entered by hand on Collections (no online payments). */}
      <section aria-labelledby="collection" className="mb-4">
        <div className="mb-2 flex items-end justify-between gap-3">
          <h2 id="collection" className="text-muted-foreground text-sm font-semibold">
            SchoolOS collection
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href={"/super-admin/collections" as Route}>Collections</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <StatCard tone="green" icon={WalletIcon} label="Total collection" value={formatMoney(collection.totalMinor)} hint={`this month ${formatMoney(collection.monthMinor)}`} href={"/super-admin/collections" as Route} />
          <StatCard tone="amber" icon={HourglassIcon} label="Pending collection" value={formatMoney(collection.pendingMinor)} hint={collection.overdueMinor ? `${formatMoney(collection.overdueMinor)} overdue` : pluralize(collection.pendingBills, "bill waiting", "bills waiting")} href={"/super-admin/collections?show=pending" as Route} />
          <StatCard tone="blue" icon={CalendarCheckIcon} label="Today's collection" value={formatMoney(collection.todayMinor)} hint={pluralize(collection.todayPayments, "payment received today", "payments received today")} href={"/super-admin/collections" as Route} />
        </div>
      </section>

      {/* People across schools: secondary to the school figures. */}
      <dl className="bg-card mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border sm:grid-cols-4">
        {[
          { label: "Students", value: totals.students, icon: GraduationCapIcon },
          { label: "Teachers", value: totals.teachers, icon: UsersIcon },
          { label: "Parents", value: totals.parents, icon: HeartHandshakeIcon },
          { label: "Active academic sessions", value: sessions, icon: BookOpenCheckIcon },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-card flex items-center gap-3 p-4">
            <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden />
            <div>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-lg font-bold tabular-nums">{formatNumber(value)}</dd>
            </div>
          </div>
        ))}
      </dl>

      <section aria-labelledby="recent-registrations" className="mb-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="recent-registrations" className="text-lg font-bold tracking-tight">
            Recent school registrations
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/super-admin/schools">View all schools</Link>
          </Button>
        </div>
        {recent.length ? (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="hidden sm:table-cell">Registered</TableHead>
                  <TableHead className="hidden lg:table-cell">Admin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((school) => {
                  const waiting = school.status === "PENDING" || school.status === "UNDER_REVIEW";
                  const href = (hash = "") => `/super-admin/schools/${school.id}${hash}` as Route;
                  return (
                    <TableRow key={school.id}>
                      <TableCell>
                        <Link href={href()} className="font-medium hover:underline">
                          {school.name}
                        </Link>
                        <p className="text-muted-foreground text-xs">{school.plan ? `${school.plan} plan` : "No plan yet"}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell">{[school.city, school.state].filter(Boolean).join(", ") || "—"}</TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(school.createdAt)}</TableCell>
                      <TableCell className="hidden lg:table-cell">{school.adminName ?? `${school.contactName} (contact)`}</TableCell>
                      <TableCell>
                        <StatusBadge status={school.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {waiting ? (
                            <>
                              <Button asChild variant="outline" size="xs">
                                <Link href={href()}>Review</Link>
                              </Button>
                              {school.contactEmailVerifiedAt ? (
                                <Button asChild size="xs" className="bg-success hover:bg-success/90 bg-none text-white shadow-none">
                                  <Link href={href("#approve")}>Approve</Link>
                                </Button>
                              ) : null}
                              <Button asChild variant="destructive" size="xs">
                                <Link href={href("#reject")}>Reject</Link>
                              </Button>
                            </>
                          ) : (
                            <Button asChild variant="outline" size="xs">
                              <Link href={href()}>View</Link>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No schools yet">Schools appear here as they register.</EmptyState>
        )}
      </section>

      <section aria-labelledby="membership" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="membership" className="text-lg font-bold tracking-tight">
              Membership
            </h2>
            <p className="text-muted-foreground text-sm">{`Whose plan or trial ends when — soonest first. Ended: ${membership.ended} · ending in 30 days: ${membership.within30} · no end date: ${membership.noEndDate}.`}</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/super-admin/calendar">Open calendar</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={"/super-admin/membership" as Route}>Send reminders</Link>
            </Button>
          </div>
        </div>
        {membership.rows.length ? (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization / school</TableHead>
                  <TableHead className="hidden sm:table-cell">Plan</TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead className="text-right">Days left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membership.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <Link href={row.href} className="font-medium hover:underline">
                        {row.title}
                      </Link>
                      <p className="text-muted-foreground text-xs sm:hidden">{row.detail}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">{row.detail}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} label={row.status === "TRIALING" ? "Trial" : row.status === "PAST_DUE" ? "Payment overdue" : "Active"} tone={row.status === "PAST_DUE" ? "negative" : row.status === "TRIALING" ? "info" : "positive"} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{row.endsOn ? formatDate(row.endsOn) : <span className="text-muted-foreground">No end date</span>}</TableCell>
                    <TableCell className="text-right">
                      {row.daysLeft === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : row.daysLeft < 0 ? (
                        <StatusBadge status="ENDED" label={row.daysLeft === -1 ? "Ended yesterday" : `Ended ${-row.daysLeft} days ago`} tone="negative" />
                      ) : row.daysLeft === 0 ? (
                        <StatusBadge status="TODAY" label="Ends today" tone="negative" />
                      ) : (
                        <StatusBadge status="LEFT" label={row.daysLeft === 1 ? "1 day" : `${row.daysLeft} days`} tone={row.daysLeft <= 7 ? "negative" : row.daysLeft <= 30 ? "warning" : "neutral"} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No memberships yet">Schools on a plan appear here with their end date.</EmptyState>
        )}
        {membership.total > membership.rows.length ? <p className="text-muted-foreground mt-2 text-xs">{`Showing ${membership.rows.length} of ${membership.total}. Membership has them all.`}</p> : null}
      </section>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Platform alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {platformAlerts.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {platformAlerts.map((alert) => (
                  <li key={alert.text}>
                    <Link href={alert.href} className={cn("hover:bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2", alert.tone === "critical" ? "border-destructive/40" : alert.tone === "warning" ? "border-warning/50" : "")}>
                      <span className={cn("size-2 shrink-0 rounded-full", alert.tone === "critical" ? "bg-destructive" : alert.tone === "warning" ? "bg-warning" : "bg-primary")} aria-hidden />
                      {alert.text}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-success-strong text-sm font-medium">All clear.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <ChartFigure title="School growth" subtitle="Registrations, last 6 months." table={{ head: ["Month", "Registered", "Approved"], rows: [...growth].reverse().map((month) => [month.fullLabel, month.registered, month.approved]) }}>
              <ColumnChart data={growth.map((month) => ({ key: month.key, label: month.label, value: month.registered }))} emptyMessage="No registrations yet." />
            </ChartFigure>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <ChartFigure title="Module adoption" subtitle={`Active schools (${adoption.activeSchools}) per optional module.`} table={{ head: ["Module", "Schools"], rows: OPTIONAL_MODULES.map((module) => [module.label, adoption.byModule[module.key] ?? 0]) }}>
              <BarChart data={OPTIONAL_MODULES.map((module) => ({ key: module.key, label: module.label, value: adoption.byModule[module.key] ?? 0 }))} labelWidth={110} width={360} emptyMessage="No active schools yet." />
            </ChartFigure>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Platform activity</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/super-admin/audit">Audit logs</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {activity.length ? (
            <ul className="divide-y">
              {activity.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 py-3">
                  <p className="text-sm">{entry.summary}</p>
                  <p className="text-muted-foreground text-xs">
                    {humanize(entry.action)} · {formatDateTime(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
