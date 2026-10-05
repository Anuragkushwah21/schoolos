import type { Route } from "next";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, toDateInput } from "@/lib/dates";
import { type getMarksSheet, TEST_STAGE_LABEL } from "@/server/exams/service";

import { adminDeleteClassTestAction, deleteClassTestAction } from "./actions";
import { EditTestForm, ImportMarksForm, MarksSheetForm, ReopenMarksForm } from "./forms";

const STAGE_TONE = { UPCOMING: "info", ENTER_MARKS: "warning", DRAFT: "warning", SUBMITTED: "info", PUBLISHED: "positive" } as const;

/**
 * One test's marks, as the teacher who set it and the School Admin both see
 * it: what the test is, where it stands, the sheet (Save draft / Submit), and
 * — while it is still a draft — editing or deleting the test itself.
 */
export function MarksSheetScreen({ sheet, role }: { sheet: Awaited<ReturnType<typeof getMarksSheet>>; role: "SCHOOL_ADMIN" | "TEACHER" }) {
  const { paper, rows, editable } = sheet;
  const entered = rows.filter((row) => row.entry !== "MISSING").length;
  const isTest = !paper.exam;
  const draft = paper.marksStatus === "DRAFT" && paper.exam?.status !== "PUBLISHED";

  const facts: Array<[string, React.ReactNode]> = [
    ["Test", paper.exam ? `${paper.exam.name} (exam paper)` : paper.name],
    ["Subject", paper.subject],
    ["Class & section", paper.section],
    ["Stream", paper.stream ?? "Whole section"],
    ["Date", formatDate(paper.date)],
    ["Maximum marks", `${paper.maxMarks} (pass ${paper.passMarks})`],
  ];
  if (paper.teacher) facts.push(["Teacher", paper.teacher]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge status={sheet.stage} label={TEST_STAGE_LABEL[sheet.stage]} tone={STAGE_TONE[sheet.stage]} />
            <span className="text-sm tabular-nums">
              <strong>{entered}</strong> of {rows.length} students entered
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {paper.description ? <p className="text-muted-foreground text-sm">{paper.description}</p> : null}
        </CardContent>
      </Card>

      {!editable ? (
        <p className="bg-muted/50 rounded-xl border px-4 py-3 text-sm">
          {!sheet.held
            ? `This test is on ${formatDate(paper.date)}. Marks can be entered from that day.`
            : paper.exam?.status === "PUBLISHED"
              ? "These exam results are published, so the marks are locked. The school office can unpublish the exam to correct them."
              : `Marks were submitted${paper.submittedAt ? ` on ${formatDateTime(paper.submittedAt)}` : ""} and are locked. ${isTest ? "Students and parents can see these results." : "The school office publishes exam results."}${role === "TEACHER" ? " To correct a mark, ask the school office to reopen it." : ""}`}
        </p>
      ) : null}

      <MarksSheetForm
        assessmentId={paper.id}
        maxMarks={paper.maxMarks}
        rows={rows}
        editable={editable}
        canSubmit={sheet.canSubmit}
        submitHint={
          isTest
            ? "Save a draft as often as you like — families see nothing yet. Submit when every student has marks or Absent: the results then reach students and parents, and the marks lock."
            : "Save a draft as often as you like. Submit when every student has marks or Absent; the school office then publishes the exam."
        }
      />

      {sheet.canReopen ? (
        <Card>
          <CardHeader>
            <CardTitle>Correct submitted marks</CardTitle>
            <CardDescription>Reopening hides these results from families until the teacher submits them again. The reason is recorded.</CardDescription>
          </CardHeader>
          <CardContent>
            <ReopenMarksForm assessmentId={paper.id} />
          </CardContent>
        </Card>
      ) : null}

      {isTest && draft ? (
        <Card>
          <CardHeader>
            <CardTitle>Test details</CardTitle>
            <CardDescription>Change the name, date or maximum while the marks are still a draft. A test can be deleted only before any marks are entered.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <EditTestForm test={{ id: paper.id, name: paper.name, date: toDateInput(paper.date), maxMarks: paper.maxMarks, description: paper.description }} />
            {entered === 0 ? (
              <ActionButton
                action={role === "TEACHER" ? deleteClassTestAction : adminDeleteClassTestAction}
                fields={{ assessmentId: paper.id }}
                variant="destructive"
                className="w-fit"
                confirm={{ title: "Delete this test?", description: "No marks have been entered, so nothing is lost.", confirmLabel: "Delete test" }}
              >
                Delete test
              </ActionButton>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Spreadsheet</CardTitle>
          <CardDescription>
            Download the class list, fill in the Marks column (or &quot;AB&quot; for absent) and import it back as a draft.
            Nothing is saved unless every row is valid.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/marks/${paper.id}/csv` as Route} prefetch={false}>
                <DownloadIcon className="size-4" aria-hidden />
                {entered ? "Download marks (CSV)" : "Download template (CSV)"}
              </Link>
            </Button>
          </div>
          {editable ? <ImportMarksForm assessmentId={paper.id} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
