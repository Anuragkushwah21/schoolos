import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OUTCOME_LABEL } from "@/lib/grades";
import type { finalResultFor } from "@/server/exams/final-results";

const TONE = { PASS: "positive", FAIL: "negative", INCOMPLETE: "neutral" } as const;

/** The session's final (weighted) result, for a student or their parent — shown only once it is final. */
export function FinalResultCard({ result }: { result: NonNullable<Awaited<ReturnType<typeof finalResultFor>>> }) {
  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{result.name}</CardTitle>
          <CardDescription>{`Worked out from ${result.components.map((row) => `${row.examName} (${row.weight}%)`).join(", ")}.`}</CardDescription>
        </div>
        <StatusBadge status={result.outcome} label={OUTCOME_LABEL[result.outcome]} tone={TONE[result.outcome]} />
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {result.subjects.map((subject) => (
            <li key={subject.subject} className="flex items-center justify-between gap-3 py-2">
              <span className="font-medium">{subject.subject}</span>
              <span className={`tabular-nums ${subject.passed === false ? "text-danger-strong font-semibold" : ""}`}>{subject.percent === null ? "—" : `${subject.percent}%${subject.grade ? ` · ${subject.grade}` : ""}`}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-2 font-semibold">
            <span>Overall</span>
            <span className="tabular-nums">{result.percent === null ? "—" : `${result.percent}%${result.grade ? ` · ${result.grade}` : ""}`}</span>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
