import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { TimetableGrid } from "@/components/shared/timetable-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttendanceHistory } from "@/features/attendance/history";
import { dayOfWeek, today } from "@/lib/dates";
import { formatPercent } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { studentHistory } from "@/server/attendance/service";
import { getSectionWeek, requireChildOfParent } from "@/server/people/portal";
import { sectionLabel } from "@/server/academics/structure";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Child" };

export default async function ParentChildPage(props: PageProps<"/parent/children/[studentId]">) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;

  // The guardian link is checked in the database; being in the same school is
  // not enough to open another family's child.
  const child = await orNotFound(requireChildOfParent(ctx, studentId));
  const current = child.enrollments.find((enrollment) => enrollment.academicSession.isCurrent);

  if (!current) {
    return (
      <>
        <PageHeader
          back={{ href: "/parent/children", label: "Children" }}
          title={`${child.firstName} ${child.lastName}`}
        />
        <EmptyState title="Not placed in a class this session" />
      </>
    );
  }

  const [history, week] = await Promise.all([
    studentHistory(ctx, child.id, current.academicSession.id),
    getSectionWeek(ctx, current.section.id, current.academicSession.id),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/parent/children", label: "Children" }}
        title={`${child.firstName} ${child.lastName}`}
        description={`${sectionLabel(current.section)}${current.rollNumber ? `, roll ${current.rollNumber}` : ""} · ${current.academicSession.name}`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Attended"
          value={formatPercent(history.counts.PRESENT + history.counts.LATE, history.counts.total)}
          hint={`${history.counts.total} days marked`}
        />
        <StatCard label="Present" value={history.counts.PRESENT} />
        <StatCard label="Late" value={history.counts.LATE} />
        <StatCard label="Absent" value={history.counts.ABSENT} />
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Timetable</CardTitle>
          </CardHeader>
          <CardContent>
            <TimetableGrid
              today={dayOfWeek(today())}
              slots={week.map((slot) => ({
                id: slot.id,
                dayOfWeek: slot.dayOfWeek,
                startMinute: slot.startMinute,
                endMinute: slot.endMinute,
                title: slot.subject.name,
                subtitle: `${slot.teacher.firstName} ${slot.teacher.lastName}`,
                meta: slot.room,
              }))}
            />
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-3 font-semibold">Attendance record</h2>
          <AttendanceHistory rows={history.rows} />
        </div>
      </div>
    </>
  );
}
