import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatPercent, pluralize } from "@/lib/format";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { photoUrlsFor } from "@/server/people/photos";
import { canMarkAttendance } from "@/server/auth/teacher-access";
import { getCurrentSession } from "@/server/academics/structure";
import { orHidden } from "@/server/page-helpers";
import { getMyRoster } from "@/server/people/teacher-self";

export const metadata: Metadata = { title: "Class students" };

/**
 * The children in one of the teacher's sections.
 *
 * The `sectionId` in the URL is untrusted. `getMyRoster` refuses a section
 * this teacher does not teach and — because the client is tenant-scoped —
 * cannot even see one belonging to another school.
 */
export default async function TeacherClassRosterPage(
  props: PageProps<"/teacher/classes/[sectionId]">,
) {
  const ctx = await requireTenant("TEACHER");
  const { sectionId } = await props.params;

  if (!(await getCurrentSession(ctx))) {
    return <NoSessionNotice title="Class" back={{ href: "/teacher/classes", label: "My classes" }} />;
  }

  // A section in another school, and one in this school that the teacher does
  // not teach, both come back as 404 rather than as two different refusals.
  const { section, students, from, to } = await orHidden(getMyRoster(ctx, sectionId));

  // Photos the teacher may see (their own section's students); initials otherwise.
  const photos = await photoUrlsFor(ctx, "STUDENT", students.map((student) => student.studentId));
  const marked = students.filter((student) => student.counts.total > 0);
  const lowest = marked.filter((student) => (student.share ?? 1) < 0.75).length;

  // Only the class teacher takes this section's daily register.
  const takesRegister = await canMarkAttendance(ctx, section.id);

  return (
    <>
      <PageHeader
        back={{ href: "/teacher/classes", label: "My classes" }}
        title={section.label}
        description={`${pluralize(students.length, "student")} · attendance since ${formatDate(from)}`}
        actions={
          takesRegister ? (
            <Button asChild>
              <Link href={`/teacher/attendance?section=${section.id}`}>Mark attendance</Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Students" value={students.length} />
        <StatCard label="With attendance marked" value={marked.length} />
        <StatCard label="Below 75%" value={lowest} hint={`since ${formatDate(from)}`} />
        <StatCard label="Window ends" value={formatDate(to)} />
      </div>

      {students.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Roll</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="hidden w-24 sm:table-cell">Gender</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-28 text-right">Attendance</TableHead>
                <TableHead className="w-24 text-right">Marked</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow key={student.studentId}>
                  <TableCell className="tabular-nums">{student.rollNumber ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <PersonAvatar name={student.name} photoUrl={photos.get(student.studentId)} />
                      <span className="font-medium">
                        {student.name}
                        {/* On a phone the column is hidden, so it rides under the name. */}
                        {student.gender ? <span className="text-muted-foreground block text-xs font-normal sm:hidden">{humanize(student.gender)}</span> : null}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell">{student.gender ? humanize(student.gender) : "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={student.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {student.share === null
                      ? "—"
                      : formatPercent(student.counts.PRESENT + student.counts.LATE, student.counts.total)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {student.counts.total}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/teacher/students/${student.studentId}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="Nobody is enrolled in this class yet">
          Students appear here once the school office places them in this section.
        </EmptyState>
      )}
    </>
  );
}
