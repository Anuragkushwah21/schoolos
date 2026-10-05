import type { Metadata } from "next";
import { HeartPulseIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { AttentionRule, AttentionTable } from "@/features/exams/attention-table";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { needsAttention } from "@/server/exams/attention";

export const metadata: Metadata = { title: "Student performance" };

/**
 * A teacher's students needing attention: in the subjects they teach, and —
 * for the section they are class teacher of — in every subject.
 */
export default async function TeacherAttentionPage() {
  const ctx = await requireTenant("TEACHER");
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="Student performance" />;
  const { rows, rule } = await needsAttention(ctx);

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
    </>
  );
}
