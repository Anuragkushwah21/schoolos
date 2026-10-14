import type { Metadata, Route } from "next";
import Link from "next/link";
import { GraduationCapIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ThresholdForm } from "@/features/academics/progress-forms";
import { CoverageCell, HomeworkCells, ReviewSummary, SectionCard } from "@/features/academics/progress-views";
import { addDays, formatDate, parseDateInput, toDateInput, today } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { academicMonitoring } from "@/server/academics/progress";
import { getCurrentSession, listSubjects, sectionOptions } from "@/server/academics/structure";
import { teacherOptions } from "@/server/people/teachers";

export const metadata: Metadata = { title: "Academic progress" };

/**
 * School leaders' academic monitoring: exceptions first — lesson records
 * missing, units behind plan, low test results not yet reviewed, units
 * marked ready, open reviews — then coverage and homework per class and
 * subject. Nothing here approves routine homework.
 */
export default async function AcademicProgressPage(props: PageProps<"/school-admin/progress">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const session = await getCurrentSession(ctx);
  if (!session) return <NoSessionNotice title="Academic progress" />;
  const search = await props.searchParams;
  const to = parseDateInput(param(search.to) ?? "") ?? today();
  const fromRaw = parseDateInput(param(search.from) ?? "") ?? addDays(to, -13);
  const from = fromRaw > to ? to : fromRaw < addDays(to, -92) ? addDays(to, -92) : fromRaw;
  const filters = { sectionId: param(search.section) ?? null, subjectId: param(search.subject) ?? null, teacherId: param(search.teacher) ?? null, from, to };
  const [data, sections, subjects, teachers] = await Promise.all([academicMonitoring(ctx, filters), sectionOptions(ctx, session.id), listSubjects(ctx, { activeOnly: true }), teacherOptions(ctx)]);
  const link = (pair: { sectionId: string; subjectId: string }, unit?: string) => `/school-admin/progress/class?section=${pair.sectionId}&subject=${pair.subjectId}${unit ? "&unit=" + unit : ""}` as Route;

  return (
    <>
      <PageHeader
        icon={GraduationCapIcon}
        tone="blue"
        title="Academic progress"
        description="What needs a look across classes and subjects — built from timetables, class records, homework and tests. Routine homework needs no approval."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/school-admin/progress/syllabus">Syllabus</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/school-admin/progress/readiness">Exam readiness</Link>
            </Button>
          </div>
        }
      />
      <FilterBar
        action="/school-admin/progress"
        selects={[
          { name: "section", label: "Class", allLabel: "All classes", defaultValue: filters.sectionId ?? "", options: sections },
          { name: "subject", label: "Subject", allLabel: "All subjects", defaultValue: filters.subjectId ?? "", options: subjects.map((subject) => ({ value: subject.id, label: subject.name })) },
          { name: "teacher", label: "Teacher", allLabel: "All teachers", defaultValue: filters.teacherId ?? "", options: teachers },
        ]}
        dates={[
          { name: "from", label: "From", defaultValue: toDateInput(from), max: toDateInput(today()) },
          { name: "to", label: "To", defaultValue: toDateInput(to), max: toDateInput(today()) },
        ]}
      />

      <div className="my-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard tone="amber" icon={GraduationCapIcon} label="Lesson records missing" value={data.missingRecords.length} hint={`${formatDate(from)} – ${formatDate(to)}`} />
        <StatCard tone="red" icon={GraduationCapIcon} label="Units behind plan" value={data.behindUnits.length} hint="planned end passed, topics left" />
        <StatCard tone="red" icon={GraduationCapIcon} label="Low tests to review" value={data.lowPerformance.length} hint={`average below ${data.threshold}%`} />
        <StatCard tone="blue" icon={GraduationCapIcon} label="Units ready for review" value={data.readyUnits.length} hint="sent by teachers" />
        <StatCard tone="purple" icon={GraduationCapIcon} label="Open reviews" value={data.openReviews.length} hint="notes, requests, revision" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <SectionCard title="Needs a look" description="Newest first. A missing lesson record is not proof a class did not happen — check the evidence shown.">
          {data.lowPerformance.length + data.readyUnits.length + data.behindUnits.length + data.missingRecords.length ? (
            <ul className="divide-y text-sm">
              {data.lowPerformance.map((row) => (
                <li key={row.stat.id} className="py-2">
                  <Link href={link(row.pair)} className="font-medium hover:underline">{`${row.section} · ${row.subject}`}</Link>
                  <p className="text-muted-foreground text-xs">{`${row.stat.name}: average ${row.stat.averagePercent}% from ${row.stat.sat} students (below ${data.threshold}%)${row.stat.itemTitle ? ` · ${row.stat.itemTitle}` : ""}`}</p>
                </li>
              ))}
              {data.readyUnits.map((row) => (
                <li key={row.review.id} className="py-2">
                  <Link href={link(row.pair)} className="font-medium hover:underline">{`${row.section} · ${row.subject}`}</Link>
                  <p className="text-muted-foreground text-xs">{`Unit ready for review: ${row.review.itemTitle ?? ""}`}</p>
                </li>
              ))}
              {data.behindUnits.map((row) => (
                <li key={`${row.pair.sectionId}-${row.unit.id}`} className="py-2">
                  <Link href={link(row.pair, row.unit.id)} className="font-medium hover:underline">{`${row.section} · ${row.subject}`}</Link>
                  <p className="text-muted-foreground text-xs">{`${row.unit.title}: ${row.unit.covered} of ${row.unit.expected} topics taught, planned to end ${row.unit.plannedTo ? formatDate(row.unit.plannedTo) : ""}`}</p>
                </li>
              ))}
              {data.missingRecords.slice(0, 30).map((row) => (
                <li key={`${row.slotId}-${row.date.getTime()}`} className="py-2">
                  <Link href={link(row.pair)} className="font-medium hover:underline">{`${row.section} · ${row.subject}`}</Link>
                  <p className="text-muted-foreground text-xs">{`Lesson record missing · ${formatDate(row.date)} · ${row.teacher} · teacher attendance: ${row.teacherAttendance ? row.teacherAttendance.toLowerCase().replace("_", " ") : "not marked"} · register: ${row.registerSubmitted ? "submitted" : "not submitted"}`}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing needs a look for these filters.</p>
          )}
        </SectionCard>
        <SectionCard title="Open reviews" description="What you asked for and where it stands.">
          {data.openReviews.length ? (
            <ul className="divide-y">
              {data.openReviews.map((row) => (
                <li key={row.review.id} className="py-2">
                  <Link href={link(row.pair)} className="text-sm font-medium hover:underline">{`${row.section} · ${row.subject}`}</Link>
                  <ReviewSummary review={row.review} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No open reviews.</p>
          )}
        </SectionCard>
      </div>

      <h2 className="mb-3 text-lg font-bold">By class and subject</h2>
      {data.rows.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class · subject</TableHead>
                <TableHead>Syllabus coverage</TableHead>
                <TableHead>Lessons</TableHead>
                <TableHead>Homework</TableHead>
                <TableHead>Tests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={`${row.pair.sectionId}-${row.pair.subjectId}`} className="align-top">
                  <TableCell>
                    <Link href={link(row.pair)} className="font-medium hover:underline">{`${row.section} · ${row.subject}`}</Link>
                    <p className="text-muted-foreground text-xs">{row.teachers.join(", ") || "No teacher assigned"}</p>
                  </TableCell>
                  <TableCell>
                    <CoverageCell percent={row.syllabus.percent} configured={row.syllabus.configured} covered={row.syllabus.covered} expected={row.syllabus.expected} />
                    {row.syllabus.behind ? <p className="text-warning-strong text-xs">{`${row.syllabus.behind} unit(s) behind plan`}</p> : null}
                  </TableCell>
                  <TableCell className="text-xs">{`${row.lessons.completed} of ${row.lessons.scheduled} recorded as taught · ${row.lessons.missingRecords.length} record(s) missing`}</TableCell>
                  <TableCell>
                    <p className="text-xs">{`${row.homework.assignedInRange} set in range · ${row.homework.overdueUnchecked} past due, not checked`}</p>
                    <HomeworkCells stat={row.homework} />
                  </TableCell>
                  <TableCell className="text-xs">{row.assessments.length ? `${row.assessments.length} test(s) · ${row.assessments.filter((stat) => stat.belowThreshold).length} below ${row.threshold}%` : "No assessment data"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No classes and subjects yet">Assign teachers to subjects, or set up the timetable, to see progress here.</EmptyState>
      )}

      {ctx.user.role === "SCHOOL_ADMIN" ? (
        <div className="mt-8 max-w-xl">
          <SectionCard title="Review threshold" description="A test linked to a class and subject whose average is below this is flagged for a look. It never blames a teacher or a student.">
            <ThresholdForm percent={data.threshold} />
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
