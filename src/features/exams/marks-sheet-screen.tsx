import type { Route } from "next";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import type { getMarksSheet } from "@/server/exams/service";

import { ImportMarksForm, MarksSheetForm } from "./forms";

/** One paper's marks, as the admin and the subject teacher both see it. */
export function MarksSheetScreen({ sheet }: { sheet: Awaited<ReturnType<typeof getMarksSheet>> }) {
  const { paper, rows, editable } = sheet;
  const entered = rows.filter((row) => row.marksObtained !== null || row.absent).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>{paper.exam ? paper.exam.name : `Class test: ${paper.name}`}</span>
        <span className="text-muted-foreground">{formatDate(paper.date)}</span>
        <span className="text-muted-foreground">
          Out of {paper.maxMarks} · pass {paper.passMarks}
        </span>
        <span className="tabular-nums">
          {entered}/{rows.length} entered
        </span>
        {paper.exam ? <StatusBadge status={paper.exam.status} /> : null}
      </div>

      {!editable ? (
        <p className="bg-muted/40 rounded-lg border px-3 py-2 text-sm">
          {sheet.held
            ? "These results are published, so marks are locked. The school office can unpublish them to make a correction."
            : `This paper is on ${formatDate(paper.date)}. Marks can be entered from that day.`}
        </p>
      ) : null}

      <MarksSheetForm assessmentId={paper.id} maxMarks={paper.maxMarks} rows={rows} editable={editable} />

      <Card>
        <CardHeader>
          <CardTitle>Spreadsheet</CardTitle>
          <CardDescription>
            Download the class list, fill in the Marks column (or &quot;AB&quot; for absent) and import it back.
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
