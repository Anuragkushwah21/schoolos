import type { Metadata, Route } from "next";
import Link from "next/link";
import { GraduationCapIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CoverageCell, HomeworkCells, ReviewBadge, SectionCard } from "@/features/academics/progress-views";
import { addDays, formatDate, today } from "@/lib/dates";
import { sectionLabel } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { computeProgress, myReviewsToAnswer, progressScope } from "@/server/academics/progress";
import { getCurrentSession } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Progress" };

/**
 * A teacher's own classes and subjects: coverage against the syllabus,
 * homework, tests, and reviews waiting for a reply. Only what they are
 * assigned to teach.
 */
export default async function TeacherProgressPage() {
  const ctx = await requireTenant("TEACHER");
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="Progress" />;
  const scope = await progressScope(ctx);
  if (!scope.pairs.length) {
    return (
      <>
        <PageHeader icon={GraduationCapIcon} tone="blue" title="Progress" />
        <EmptyState title="No classes or subjects assigned">No classes or subjects have been assigned to you. Please contact your School Admin.</EmptyState>
      </>
    );
  }
  const now = today();
  const [progress, reviews] = await Promise.all([computeProgress(ctx, scope, scope.pairs, { from: addDays(now, -30), to: now }), myReviewsToAnswer(ctx)]);
  const rows = [...progress.values()].sort((a, b) => a.section.localeCompare(b.section) || a.subject.localeCompare(b.subject));
  const link = (sectionId: string, subjectId: string) => `/teacher/progress/class?section=${sectionId}&subject=${subjectId}` as Route;

  return (
    <>
      <PageHeader icon={GraduationCapIcon} tone="blue" title="Progress" description="Record topics in each class record, link homework and tests to the syllabus, and mark a unit ready when its topics are taught." />
      {reviews.length ? (
        <div className="mb-6">
          <SectionCard title="Waiting for your reply" description="From your school leaders.">
            <ul className="divide-y text-sm">
              {reviews.map((review) => (
                <li key={review.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={link(review.sectionId, review.subjectId)} className="font-medium hover:underline">{`${sectionLabel(review.section)} · ${review.subject.name}`}</Link>
                  <span className="flex items-center gap-2">
                    <ReviewBadge status={review.status} />
                    {review.revisionPlannedOn ? <span className="text-muted-foreground text-xs">{`planned ${formatDate(review.revisionPlannedOn)}`}</span> : null}
                  </span>
                  {review.note ? <p className="text-muted-foreground w-full text-xs">{review.note}</p> : null}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class · subject</TableHead>
              <TableHead>Syllabus coverage</TableHead>
              <TableHead>Lesson records (30 days)</TableHead>
              <TableHead>Homework</TableHead>
              <TableHead>Tests</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.pair.sectionId}-${row.pair.subjectId}`} className="align-top">
                <TableCell>
                  <Link href={link(row.pair.sectionId, row.pair.subjectId)} className="font-medium hover:underline">{`${row.section} · ${row.subject}`}</Link>
                  <p>
                    <Link href={`/teacher/progress/readiness?section=${row.pair.sectionId}` as Route} className="text-primary text-xs underline">
                      Exam readiness
                    </Link>
                  </p>
                </TableCell>
                <TableCell>
                  <CoverageCell percent={row.syllabus.percent} configured={row.syllabus.configured} covered={row.syllabus.covered} expected={row.syllabus.expected} />
                </TableCell>
                <TableCell className="text-xs">{`${row.lessons.completed} recorded as taught · ${row.lessons.missingRecords.length} missing`}</TableCell>
                <TableCell>
                  <HomeworkCells stat={row.homework} />
                </TableCell>
                <TableCell className="text-xs">{row.assessments.length ? `${row.assessments.length} test(s) · ${row.assessments.filter((stat) => stat.belowThreshold).length} below ${row.threshold}%` : "No assessment data"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
