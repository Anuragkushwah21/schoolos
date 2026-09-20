import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { AttendanceHistory } from "@/features/attendance/history";
import { formatPercent } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { studentHistory } from "@/server/attendance/service";
import { getStudentPlacement } from "@/server/people/portal";

export const metadata: Metadata = { title: "Attendance" };

export default async function StudentAttendancePage() {
  const ctx = await requireTenant("STUDENT");
  const { student, session } = await getStudentPlacement(ctx);

  if (!session) {
    return (
      <>
        <PageHeader title="Attendance" />
        <EmptyState title="No current academic session" />
      </>
    );
  }

  const history = await studentHistory(ctx, student.id, session.id);

  return (
    <>
      <PageHeader title="Your attendance" description={`Session ${session.name}`} />
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
      <AttendanceHistory rows={history.rows} />
    </>
  );
}
