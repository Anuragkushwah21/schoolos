import { GraduationCapIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/fields";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatusBadge } from "@/components/shared/status-badge";
import { EXAM_STAGE_LABEL, EXAM_STAGE_TONE, EXAM_STAGES } from "@/lib/exam-stage";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import { publishExamsAction } from "@/features/exams/actions";
import { formatDate } from "@/lib/dates";
import { enumParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { listExams } from "@/server/exams/service";

export const metadata: Metadata = { title: "Examinations" };

export default async function ExamsPage(props: PageProps<"/school-admin/exams">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Examinations" need="session" />;

  const search = await props.searchParams;
  const sectionId = param(search.section);
  // The stage is worked out from marks, so it is filtered here rather than in the query.
  const stage = enumParam(search.status, EXAM_STAGES);
  const [all, sections] = await Promise.all([
    listExams(ctx, { academicSessionId: session.id, sectionId }),
    sectionOptions(ctx, session.id),
  ]);
  const exams = stage ? all.filter((exam) => exam.stage === stage) : all;
  const ready = exams.filter((exam) => exam.stage === "READY_TO_PUBLISH").length;

  return (
    <>
      <PageHeader icon={GraduationCapIcon} tone="purple"
        title="Examinations"
        description={`${session.name} · results stay hidden from students and parents until published.`}
        actions={
          <Button asChild>
            <Link href="/school-admin/exams/new">New exam</Link>
          </Button>
        }
      />
      <FilterBar
        action="/school-admin/exams"
        selects={[
          { name: "section", label: "Section", defaultValue: sectionId, allLabel: "All sections", options: sections },
          {
            name: "status",
            label: "Status",
            defaultValue: stage,
            allLabel: "Any status",
            options: EXAM_STAGES.map((value) => ({ value, label: EXAM_STAGE_LABEL[value] })),
          },
        ]}
      />

      {exams.length ? (
        <ActionForm action={publishExamsAction}>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-3 py-2 font-medium">Exam</th>
                  <th className="px-3 py-2 font-medium">Section</th>
                  <th className="px-3 py-2 font-medium">Dates</th>
                  <th className="px-3 py-2 font-medium">Marks entered</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((exam) => (
                  <tr key={exam.id} className="border-t">
                    <td className="px-3 py-2">
                      {exam.stage === "READY_TO_PUBLISH" ? (
                        <input
                          type="checkbox"
                          name="examIds"
                          value={exam.id}
                          aria-label={`Select ${exam.name} for ${exam.section}`}
                          className="accent-primary size-4"
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/school-admin/exams/${exam.id}` as Route} className="font-medium hover:underline">
                        {exam.name}
                      </Link>
                      <span className="text-muted-foreground block text-xs">{exam.papers} papers</span>
                    </td>
                    <td className="px-3 py-2">{exam.section}</td>
                    <td className="text-muted-foreground px-3 py-2 tabular-nums">
                      {formatDate(exam.startDate)} – {formatDate(exam.endDate)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {exam.entered}/{exam.expected}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        <TimeStatusBadge status={exam.timeStatus} />
                        <StatusBadge status={exam.stage} label={EXAM_STAGE_LABEL[exam.stage]} tone={EXAM_STAGE_TONE[exam.stage]} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            {ready ? <SubmitButton pendingLabel="Publishing…">Publish selected results</SubmitButton> : null}
            <p className="text-muted-foreground text-xs">
              {ready
                ? `${ready} exam${ready === 1 ? " is" : "s are"} ready to publish — tick the ones to release.`
                : "Nothing is ready to publish yet. An exam is ready once every paper is held and every mark is in."}
            </p>
          </div>
        </ActionForm>
      ) : (
        <EmptyState title="No exams yet" action={<Button asChild><Link href="/school-admin/exams/new">Create an exam</Link></Button>}>
          Create an exam for one or more sections, then teachers enter marks for their subjects.
        </EmptyState>
      )}
    </>
  );
}
