import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteExamAction, publishExamsAction, unpublishExamAction } from "@/features/exams/actions";
import { EditExamForm } from "@/features/exams/forms";
import { formatDate, toDateInput } from "@/lib/dates";
import { EXAM_STAGE_LABEL, EXAM_STAGE_TONE } from "@/lib/exam-stage";
import { OUTCOME_LABEL, passMarkFor } from "@/lib/grades";
import { requireTenant } from "@/server/auth/current-user";
import { getExamDetail } from "@/server/exams/service";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Exam" };

const OUTCOME_TONE = { PASS: "positive", FAIL: "negative", INCOMPLETE: "neutral" } as const;

export default async function ExamDetailPage(props: PageProps<"/school-admin/exams/[examId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { examId } = await props.params;
  const { exam, papers, students, stage, blocker } = await orNotFound(getExamDetail(ctx, examId));
  const published = exam.status === "PUBLISHED";
  // The first paper still short of marks: where "View missing marks" goes.
  const firstShort = papers.find((paper) => paper.held && paper.entered < paper.expected);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/exams", label: "Examinations" }}
        title={`${exam.name} · ${exam.sectionLabel}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {exam.academicSession.name} · {formatDate(exam.startDate)} – {formatDate(exam.endDate)}
            <TimeStatusBadge status={exam.timeStatus} />
            <StatusBadge status={stage} label={EXAM_STAGE_LABEL[stage]} tone={EXAM_STAGE_TONE[stage]} />
          </span>
        }
        actions={
          published ? (
            <ActionButton
              action={unpublishExamAction}
              fields={{ examId: exam.id }}
              variant="outline"
              confirm={{
                title: "Withdraw these results?",
                description: "Students and parents stop seeing them until you publish again. Marks can then be corrected.",
                confirmLabel: "Withdraw",
              }}
            >
              Unpublish
            </ActionButton>
          ) : (
            <>
              <ActionButton
                action={deleteExamAction}
                fields={{ examId: exam.id }}
                variant="destructive"
                confirm={{
                  title: "Delete this draft exam?",
                  description: "Its papers and every mark entered for them are deleted. This cannot be undone.",
                  confirmLabel: "Delete",
                }}
              >
                Delete
              </ActionButton>
              {blocker ? (
                // Not ready: the button stays visible so the next step is clear,
                // and the panel below says what is missing.
                <Button disabled title={`${blocker.headline} ${blocker.detail}`}>
                  Publish results
                </Button>
              ) : (
                <ActionButton
                  action={publishExamsAction}
                  fields={{ examIds: exam.id }}
                  confirm={{
                    title: "Publish these results?",
                    description: "Students and parents will see the marks and report cards.",
                    confirmLabel: "Publish results",
                  }}
                >
                  Publish results
                </ActionButton>
              )}
            </>
          )
        }
      />

      {!published && blocker ? (
        <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-strong">
          <p>
            <span className="font-medium">{blocker.headline}</span> {blocker.detail}
          </p>
          <Button asChild size="sm" variant="outline">
            {blocker.action === "marks" && firstShort ? (
              <Link href={`/school-admin/exams/papers/${firstShort.id}` as Route}>View missing marks</Link>
            ) : (
              <Link href={"#papers" as Route}>View pending papers</Link>
            )}
          </Button>
        </div>
      ) : !published ? (
        <p role="status" className="border-success/30 bg-success-soft text-success-strong mb-6 rounded-lg border px-4 py-3 text-sm">
          Every paper is held and every mark is in. Results are ready to publish.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card id="papers">
          <CardHeader>
            <CardTitle>Papers</CardTitle>
            <CardDescription>Teachers enter marks for their own subjects; you can enter or correct any.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Subject</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Max / pass</th>
                    <th className="py-2 pr-3 font-medium">Entered</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {papers.map((paper) => (
                    <tr key={paper.id} className="border-t">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{paper.subject}</span>
                        <span className="text-muted-foreground block text-xs">{paper.teacher ?? "No teacher assigned"}</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatDate(paper.date)}
                        {!paper.held ? <span className="text-muted-foreground block text-xs">not held yet</span> : null}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {paper.maxMarks} / {passMarkFor(paper.maxMarks, paper.passMarks)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {paper.entered}/{paper.expected}
                      </td>
                      <td className="py-2 text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/school-admin/exams/papers/${paper.id}` as Route}>{published || !paper.held ? "View" : "Marks"}</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {!published ? (
          <Card>
            <CardHeader>
              <CardTitle>Exam details</CardTitle>
            </CardHeader>
            <CardContent>
              <EditExamForm
                exam={{ id: exam.id, name: exam.name, startDate: toDateInput(exam.startDate), endDate: toDateInput(exam.endDate) }}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Results</CardTitle>
          <CardDescription>Totals count an absent paper as zero. Report cards open ready to print.</CardDescription>
        </CardHeader>
        <CardContent>
          {students.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Student</th>
                    <th className="py-2 pr-3 text-right font-medium">Total</th>
                    <th className="py-2 pr-3 text-right font-medium">%</th>
                    <th className="py-2 pr-3 font-medium">Grade</th>
                    <th className="py-2 pr-3 font-medium">Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.studentId} className="border-t">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{student.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {[student.rollNumber ? `Roll ${student.rollNumber}` : null, student.admissionNumber].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {student.total}/{student.maxTotal}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{student.percent ?? "—"}</td>
                      <td className="py-2 pr-3">{student.grade ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={student.outcome} label={OUTCOME_LABEL[student.outcome]} tone={OUTCOME_TONE[student.outcome]} />
                      </td>
                      <td className="py-2 text-right">
                        <Button asChild size="xs" variant="ghost">
                          <Link href={`/report-cards/${exam.id}/${student.studentId}` as Route} target="_blank">
                            Report card
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No students in this section" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
