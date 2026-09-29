import type { Route } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { OUTCOME_LABEL } from "@/lib/grades";
import type { publishedExamsFor } from "@/server/exams/results";

const TONE = { PASS: "positive", FAIL: "negative", INCOMPLETE: "neutral" } as const;

/** Published exams with the headline result and the report card, for a student or their parent. */
export function PublishedExams({
  exams,
  studentId,
}: {
  exams: Awaited<ReturnType<typeof publishedExamsFor>>;
  studentId: string;
}) {
  if (!exams.length) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Exam results</CardTitle>
        <CardDescription>Published by the school. Open a report card to print or save it.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {exams.map((exam) => (
            <li key={exam.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{exam.name}</span>
                <span className="text-muted-foreground block text-xs">
                  {formatDate(exam.startDate)} – {formatDate(exam.endDate)}
                </span>
              </span>
              <span className="text-sm tabular-nums">
                {exam.total}/{exam.maxTotal}
                {exam.percent === null ? "" : ` · ${exam.percent}%`}
                {exam.grade ? ` · ${exam.grade}` : ""}
              </span>
              <StatusBadge status={exam.outcome} label={OUTCOME_LABEL[exam.outcome]} tone={TONE[exam.outcome]} />
              <Button asChild size="sm" variant="outline">
                <Link href={`/report-cards/${exam.id}/${studentId}` as Route} target="_blank">
                  Report card
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
