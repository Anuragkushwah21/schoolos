import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { MyPhotoCard } from "@/features/photos/my-photo-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
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
import { formatDate, formatDateTime, formatMonth, today } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getMyAttendance, getMyProfile } from "@/server/people/teacher-self";

export const metadata: Metadata = { title: "My record" };

/** `YYYY-MM`, as the month links produce it. */
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** The month to show: the one asked for, or the current one. */
function resolveMonth(raw: string | undefined): { year: number; month: number } {
  const now = today();
  const match = raw ? MONTH_PATTERN.exec(raw) : null;
  if (!match) return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  const year = Number(match[1]);
  const month = Number(match[2]);
  // A month outside the calendar is not a request worth honouring.
  if (month < 1 || month > 12 || year < 2000 || year > now.getUTCFullYear() + 1) {
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }
  return { year, month };
}

function shiftMonth({ year, month }: { year: number; month: number }, by: number): string {
  const shifted = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The teacher's own record: what the school holds about them, and their own
 * attendance.
 *
 * Read-only throughout. Their designation, joining date and assignments are
 * the school's record of them rather than a profile they own, and a teacher
 * marking their own attendance would make the register worthless — so this
 * page only reads. Their sign-in email and password live under Account.
 */
export default async function TeacherProfilePage(props: PageProps<"/teacher/profile">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;

  const month = resolveMonth(param(search.month));
  const [profile, attendance] = await Promise.all([
    getMyProfile(ctx),
    getMyAttendance(ctx, month),
  ]);

  if (!profile) {
    return (
      <>
        <PageHeader title="My record" />
        <EmptyState title="Your staff record is not set up yet">
          Ask the school office to finish your profile. Until they do, there is nothing here to
          show.
        </EmptyState>
      </>
    );
  }

  const { teacher } = profile;

  return (
    <>
      <PageHeader
        title={teacher.name}
        description={
          profile.session
            ? `${profile.school.name} · ${profile.session.name}`
            : profile.school.name
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/account">Account settings</Link>
          </Button>
        }
      />

      <MyPhotoCard ctx={ctx} name={teacher.name} className="mb-6 max-w-2xl" />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Staff record</CardTitle>
              <CardDescription>
                Held by the school office. Ask them to correct anything that is wrong.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Employee id" value={teacher.employeeId ?? "—"} />
                <Detail label="Status" value={<StatusBadge status={teacher.status} />} />
                <Detail label="Sign-in email" value={teacher.loginEmail} />
                <Detail label="Record email" value={teacher.email ?? "—"} />
                <Detail label="Phone" value={teacher.phone ?? "—"} />
                <Detail label="Qualification" value={teacher.qualification ?? "—"} />
                <Detail label="Joined" value={formatDate(teacher.joiningDate)} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What you teach</CardTitle>
              <CardDescription>
                {!profile.session
                  ? "The school has not opened an academic year yet."
                  : profile.assignments.length
                    ? `${pluralize(profile.assignments.length, "assignment")} this session.`
                    : "Nothing assigned this session."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {profile.classTeacherOf.length ? (
                <p className="text-sm">
                  Class teacher of{" "}
                  {profile.classTeacherOf.map((section) => section.label).join(", ")}.
                </p>
              ) : null}
              {profile.assignments.length ? (
                <ul className="divide-y">
                  {profile.assignments.map((assignment) => (
                    <li
                      key={assignment.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{assignment.subject}</p>
                        <p className="text-muted-foreground text-xs">{assignment.section}</p>
                      </div>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/teacher/classes/${assignment.sectionId}`}>Students</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {profile.session
                    ? "Your subjects appear here once the office records them."
                    : "Your subjects appear here once the office opens the academic year and records them."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Attended"
              value={attendance.share === null ? "—" : `${Math.round(attendance.share * 100)}%`}
              hint={formatMonth(attendance.from)}
            />
            <StatCard label="Present" value={attendance.counts.PRESENT} />
            <StatCard label="Absent" value={attendance.counts.ABSENT} />
            <StatCard label="On leave" value={attendance.counts.ON_LEAVE} />
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>My attendance</CardTitle>
                <CardDescription>
                  {formatMonth(attendance.from)} · marked by the school office.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/teacher/profile?month=${shiftMonth(month, -1)}`}>Earlier</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/teacher/profile?month=${shiftMonth(month, 1)}`}>Later</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {attendance.rows.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-32">Date</TableHead>
                        <TableHead className="w-28">Status</TableHead>
                        <TableHead className="hidden sm:table-cell">In</TableHead>
                        <TableHead className="hidden sm:table-cell">Out</TableHead>
                        <TableHead>Remarks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendance.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="tabular-nums">{formatDate(row.date)}</TableCell>
                          <TableCell>
                            <StatusBadge status={row.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground hidden sm:table-cell">
                            {row.checkInTime ? formatDateTime(row.checkInTime) : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground hidden sm:table-cell">
                            {row.checkOutTime ? formatDateTime(row.checkOutTime) : "—"}
                          </TableCell>
                          <TableCell className="whitespace-normal">{row.remarks ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title={`Nothing marked in ${formatMonth(attendance.from)}`}>
                  Staff attendance is taken by the school office.
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
