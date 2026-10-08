import type { Metadata } from "next";
import { HeartPulseIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AttentionSettingsForm } from "@/features/exams/attention-forms";
import { AttentionRule, AttentionTable } from "@/features/exams/attention-table";
import { param } from "@/lib/search-params";
import { getCurrentSession, listSubjects, sectionOptions } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { needsAttention } from "@/server/exams/attention";

export const metadata: Metadata = { title: "Student performance" };

/**
 * Exams & Results → Student Performance: who needs attention in which
 * subject, and why — by a rule the school sets and every row explains.
 */
export default async function PerformancePage(props: PageProps<"/school-admin/exams/performance">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Student performance" need="session" />;
  const search = await props.searchParams;
  const sectionId = param(search.section);
  const subjectId = param(search.subject);
  const [{ rows, settings, rule }, sections, subjects] = await Promise.all([
    needsAttention(ctx, { sectionId, subjectId }),
    sectionOptions(ctx, session.id),
    listSubjects(ctx),
  ]);
  const students = new Set(rows.map((row) => row.studentId)).size;

  return (
    <>
      <PageHeader icon={HeartPulseIcon} tone="orange" title="Student performance" description="Students who need attention in a subject, and why. Start support straight from a row." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard tone="orange" icon={HeartPulseIcon} label="Students needing attention" value={students} />
        <StatCard tone="amber" icon={HeartPulseIcon} label="Subjects flagged" value={rows.length} />
        <StatCard tone="green" icon={HeartPulseIcon} label="With support open" value={rows.filter((row) => row.supportId).length} />
      </div>
      <AttentionRule rule={rule} />
      <FilterBar
        action="/school-admin/exams/performance"
        selects={[
          { name: "section", label: "Section", defaultValue: sectionId, allLabel: "All sections", options: sections },
          { name: "subject", label: "Subject", defaultValue: subjectId, allLabel: "All subjects", options: subjects.map((row) => ({ value: row.id, label: row.name })) },
        ]}
      />
      {rows.length ? (
        <AttentionTable rows={rows} studentHref={(row) => `/school-admin/students/${row.studentId}`} supportBase="/school-admin/support" />
      ) : (
        <EmptyState icon={HeartPulseIcon} tone="green" title="Nobody needs attention right now">
          Students appear here when their submitted results fall below the rule, or when a teacher opens support.
        </EmptyState>
      )}
      <Card className="mt-8 max-w-3xl">
        <CardHeader>
          <CardTitle>The rule</CardTitle>
          <CardDescription>Applies to submitted tests and published exams, this session.</CardDescription>
        </CardHeader>
        <CardContent>
          {ctx.user.role === "SCHOOL_ADMIN" ? (
            <AttentionSettingsForm percent={settings.percent} repeat={settings.repeat} />
          ) : (
            <p className="text-sm">{`A student needs attention below ${settings.percent}% in a subject, or when ${settings.repeat} of their last three tests are below it. The School Admin sets this rule.`}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
