import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClassTestForm } from "@/features/exams/forms";
import { formatDate, today, toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { listMyPapers } from "@/server/exams/service";

export const metadata: Metadata = { title: "Exams & marks" };

/** Every paper this teacher marks: exam papers from the office, and their own class tests. */
export default async function TeacherExamsPage() {
  const ctx = await requireTenant("TEACHER");
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="Exams & marks" />;
  const { papers, assignments } = await listMyPapers(ctx);

  return (
    <>
      <PageHeader title="Exams & marks" description="Enter marks for the subjects you teach. Exam results reach families once the office publishes them." />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Papers to mark</CardTitle>
          </CardHeader>
          <CardContent>
            {papers.length ? (
              <ul className="divide-y">
                {papers.map((paper) => (
                  <li key={paper.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {paper.subject} · {paper.name}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {paper.section} · {formatDate(paper.date)} · out of {paper.maxMarks}
                      </span>
                    </span>
                    {!paper.held ? <TimeStatusBadge status="UPCOMING" label="Not held yet" /> : null}
                    {paper.kind === "EXAM" ? (
                      <StatusBadge status={paper.published ? "PUBLISHED" : "DRAFT"} label={paper.published ? "Published" : "Exam"} />
                    ) : (
                      <StatusBadge status="INFO" tone="info" label="Class test" />
                    )}
                    <span className="text-sm tabular-nums">
                      {paper.entered}/{paper.expected}
                    </span>
                    <Button asChild size="sm" variant={paper.held && paper.entered < paper.expected && !paper.published ? "default" : "outline"}>
                      <Link href={`/teacher/exams/${paper.id}` as Route}>{paper.published || !paper.held ? "View" : "Marks"}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing to mark yet">Exam papers for your subjects appear here, as do tests you set.</EmptyState>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New class test</CardTitle>
            <CardDescription>Marks you enter are visible to students and parents straight away.</CardDescription>
          </CardHeader>
          <CardContent>
            {assignments.length ? (
              <ClassTestForm
                today={toDateInput(today())}
                options={assignments.map((row) => ({ value: `${row.sectionId}|${row.subjectId}`, label: row.label }))}
              />
            ) : (
              <p className="text-muted-foreground text-sm">You are not assigned any subjects this session.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
