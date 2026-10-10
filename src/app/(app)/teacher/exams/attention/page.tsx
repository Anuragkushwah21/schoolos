import type { Metadata } from "next";
import { HeartPulseIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { AttentionByClassTable, AttentionRule, AttentionTable, SignalTable } from "@/features/exams/attention-table";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { needsAttention } from "@/server/exams/attention";
import { attendanceHomeworkSignals, attentionByClass } from "@/server/exams/student-signals";

export const metadata: Metadata = { title: "Student performance" };

/**
 * A teacher's students needing attention: in the subjects they teach, and —
 * for the section they are class teacher of — in every subject.
 */
export default async function TeacherAttentionPage() {
  const ctx = await requireTenant("TEACHER");
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="Student performance" />;
  const [{ rows, rule }, signals, byClass] = await Promise.all([needsAttention(ctx), attendanceHomeworkSignals(ctx), attentionByClass(ctx)]);

  return (
    <>
      <PageHeader icon={HeartPulseIcon} tone="orange" title="Student performance" description="Students who need attention in the subjects you teach (and, for your own class, in every subject)." />
      <AttentionRule rule={rule} />
      {rows.length ? (
        <AttentionTable rows={rows} studentHref={(row) => `/teacher/students/${row.studentId}`} supportBase="/teacher/support" />
      ) : (
        <EmptyState icon={HeartPulseIcon} tone="green" title="Nobody needs attention right now">
          Students appear here when submitted results fall below the school&apos;s rule, or when support is opened.
        </EmptyState>
      )}
      <h2 className="mt-8 mb-2 text-base font-semibold">Attendance and homework</h2>
      <AttentionRule rule={signals.rule} />
      {signals.rows.length ? (
        <SignalTable rows={signals.rows} studentHref={(row) => `/teacher/students/${row.studentId}`} supportBase="/teacher/support" />
      ) : (
        <p className="text-muted-foreground text-sm">No student&apos;s attendance or homework needs attention in your classes right now.</p>
      )}
      {byClass.length ? (
        <>
          <h2 className="mt-8 mb-2 text-base font-semibold">Your classes</h2>
          <AttentionByClassTable rows={byClass} />
        </>
      ) : null}
    </>
  );
}
