import type { Route } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import type { AssessmentStat, HomeworkStat, ReviewRow, UnitProgress } from "@/server/academics/progress";
import { SCORE_BANDS } from "@/server/academics/progress";

/**
 * Read-only pieces shared by the leader and teacher pages. Every figure
 * names what it measures; a missing figure says why rather than showing 0.
 */

export function Percent({ value, empty }: { value: number | null; empty: string }) {
  return value === null ? <span className="text-muted-foreground">{empty}</span> : <span className="tabular-nums">{`${value}%`}</span>;
}

export function CoverageCell({ percent, configured, covered, expected }: { percent: number | null; configured: boolean; covered: number; expected: number }) {
  if (!configured) return <span className="text-muted-foreground">Syllabus not configured</span>;
  return (
    <span className="flex flex-col">
      <Percent value={percent} empty="—" />
      <span className="text-muted-foreground text-xs">{`${covered} of ${expected} topics taught`}</span>
    </span>
  );
}

export function HomeworkCells({ stat }: { stat: HomeworkStat }) {
  return (
    <span className="flex flex-col text-xs">
      <span>
        Submitted: <Percent value={stat.submissionRate} empty="no homework due" />
      </span>
      <span className="text-muted-foreground">
        Checked by teacher: <Percent value={stat.reviewRate} empty="—" />
      </span>
    </span>
  );
}

const REVIEW_LABEL: Record<string, { label: string; tone: "positive" | "warning" | "neutral" | "info" | "negative" }> = {
  OPEN: { label: "Open", tone: "warning" },
  UPDATE_REQUESTED: { label: "Update requested", tone: "warning" },
  REVISION_RECOMMENDED: { label: "Revision recommended", tone: "warning" },
  REVISION_PLANNED: { label: "Revision planned", tone: "info" },
  REVISION_DONE: { label: "Revision done", tone: "info" },
  RESOLVED: { label: "Closed", tone: "positive" },
};

export function ReviewBadge({ status }: { status: string }) {
  const entry = REVIEW_LABEL[status] ?? { label: status, tone: "neutral" as const };
  return <StatusBadge status={status} label={entry.label} tone={entry.tone} />;
}

const KIND_LABEL: Record<string, string> = { UNIT_READY: "Unit ready for review", LOW_PERFORMANCE: "Low test result", NOTE: "Leader's note" };

export function ReviewSummary({ review }: { review: ReviewRow }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{KIND_LABEL[review.kind] ?? review.kind}</span>
        <ReviewBadge status={review.status} />
        <span className="text-muted-foreground text-xs">{formatDate(review.updatedAt)}</span>
      </div>
      {review.itemTitle || review.assessment ? <p className="text-muted-foreground text-xs">{[review.itemTitle, review.assessment?.name].filter(Boolean).join(" · ")}</p> : null}
      {review.note ? <p>{`Leader: ${review.note}`}</p> : null}
      {review.teacherResponse ? <p>{`Teacher: ${review.teacherResponse}`}</p> : null}
      {review.revisionPlannedOn || review.revisionDate || review.followUp ? (
        <p className="text-muted-foreground text-xs">
          {[review.revisionPlannedOn ? `Revision planned ${formatDate(review.revisionPlannedOn)}` : null, review.revisionDate ? `Revision taught ${formatDate(review.revisionDate)}` : null, review.followUp ? `Follow-up: ${review.followUp.name}` : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

export function AssessmentTable({ stats, threshold }: { stats: AssessmentStat[]; threshold: number }) {
  if (!stats.length) return <p className="text-muted-foreground text-sm">No assessment data — no test with submitted marks is linked here yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            <th className="py-1.5 font-medium">Test</th>
            <th className="py-1.5 font-medium">Covers</th>
            <th className="py-1.5 text-right font-medium">Took part</th>
            <th className="py-1.5 text-right font-medium">Average</th>
            <th className="py-1.5 font-medium">Spread</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr key={stat.id} className="border-t align-top">
              <td className="py-1.5">
                {stat.name}
                <p className="text-muted-foreground text-xs">{formatDate(stat.date)}</p>
              </td>
              <td className="text-muted-foreground py-1.5 text-xs">{stat.itemTitle ?? "Not linked to the syllabus"}</td>
              <td className="py-1.5 text-right tabular-nums">{`${stat.sat} of ${stat.roster}`}</td>
              <td className="py-1.5 text-right">
                {stat.averagePercent === null ? <span className="text-muted-foreground">No marks</span> : stat.belowThreshold ? <StatusBadge status="LOW" label={`${stat.averagePercent}% — below ${threshold}%`} tone="warning" /> : <span className="tabular-nums">{`${stat.averagePercent}%`}</span>}
              </td>
              <td className="text-muted-foreground py-1.5 text-xs">{SCORE_BANDS.map((band, index) => `${band.label}: ${stat.bands[index]}`).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UnitRow({ unit, href }: { unit: UnitProgress; href: Route }) {
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={href} className="font-medium hover:underline">
          {unit.title}
        </Link>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {unit.behind ? <StatusBadge status="BEHIND" label="Behind plan" tone="warning" /> : null}
          {unit.readyReview ? <ReviewBadge status={unit.readyReview.status} /> : null}
          <span className="tabular-nums">{unit.expected ? `${unit.covered} of ${unit.expected} topics taught${unit.partial ? ` · ${unit.partial} partly` : ""}` : "No topics yet"}</span>
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {[unit.plannedFrom || unit.plannedTo ? `Planned ${unit.plannedFrom ? formatDate(unit.plannedFrom) : "…"} – ${unit.plannedTo ? formatDate(unit.plannedTo) : "…"}` : "No planned dates", `Homework ${unit.homework.assigned}`, unit.assessments.length ? `Tests ${unit.assessments.length}` : "No assessment data"].join(" · ")}
      </p>
    </li>
  );
}

/** The measures, side by side and named — never combined into one score. */
export function MeasuresCard({ syllabus, homework, assessments }: { syllabus: { configured: boolean; percent: number | null; covered: number; expected: number }; homework: HomeworkStat; assessments: AssessmentStat[] }) {
  const sat = assessments.reduce((sum, stat) => sum + stat.sat, 0);
  const roster = assessments.reduce((sum, stat) => sum + stat.roster, 0);
  const marked = assessments.filter((stat) => stat.averagePercent !== null);
  const average = marked.length ? Math.round((marked.reduce((sum, stat) => sum + stat.averagePercent!, 0) / marked.length) * 10) / 10 : null;
  const items = [
    { label: "Syllabus coverage", value: syllabus.configured ? <Percent value={syllabus.percent} empty="—" /> : <span className="text-muted-foreground text-sm">Syllabus not configured</span>, hint: syllabus.configured ? `${syllabus.covered} of ${syllabus.expected} topics recorded as taught` : "Set up units and topics to measure it" },
    { label: "Homework submitted", value: <Percent value={homework.submissionRate} empty="—" />, hint: homework.due ? `${homework.submitted + homework.late} of ${homework.expected} (on time or late), homework already due` : "No homework due yet" },
    { label: "Homework checked by teacher", value: <Percent value={homework.reviewRate} empty="—" />, hint: homework.due ? `${homework.expected - homework.unchecked} of ${homework.expected} recorded` : "No homework due yet" },
    { label: "Test participation", value: <Percent value={roster ? Math.round((sat / roster) * 1000) / 10 : null} empty="—" />, hint: assessments.length ? `${sat} of ${roster} across ${assessments.length} test(s)` : "No assessment data" },
    { label: "Test performance", value: <Percent value={average} empty="—" />, hint: marked.length ? "Average of each test's average" : "No assessment data" },
  ];
  return (
    <dl className="bg-card grid grid-cols-1 gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="bg-card flex flex-col gap-1 p-4">
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd className="text-lg font-bold">{item.value}</dd>
          <dd className="text-muted-foreground text-xs">{item.hint}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
