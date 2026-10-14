import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { PairOverview, UnitReportView } from "@/features/academics/pair-report";
import { addDays, formatDate, today } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { pairProgress, unitReport } from "@/server/academics/progress";
import { orHidden } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Class progress" };

/** One of the teacher's own classes and subjects — or one of its units. */
export default async function TeacherClassProgressPage(props: PageProps<"/teacher/progress/class">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;
  const pair = { sectionId: param(search.section) ?? "", subjectId: param(search.subject) ?? "" };
  const unitId = param(search.unit);
  const progress = await orHidden(pairProgress(ctx, pair));
  const report = unitId ? await orHidden(unitReport(ctx, pair, unitId)) : null;
  const teacher = await requireTeacherSelf(ctx);
  // For replying to a review: their own recorded lessons and the tests of this class and subject.
  const [lessons, tests] = await Promise.all([
    ctx.db.classSession.findMany({
      where: { timetableSlot: { sectionId: pair.sectionId, subjectId: pair.subjectId }, status: { in: ["COMPLETED", "SUBSTITUTE", "REMOTE"] }, date: { gte: addDays(today(), -60) }, OR: [{ actualTeacherId: teacher.id }, { scheduledTeacherId: teacher.id }] },
      orderBy: { date: "desc" },
      take: 40,
      select: { id: true, date: true, topic: true },
    }),
    ctx.db.assessment.findMany({ where: { sectionId: pair.sectionId, subjectId: pair.subjectId, academicSession: { isCurrent: true } }, orderBy: { date: "desc" }, take: 40, select: { id: true, name: true, date: true } }),
  ]);
  const mode = {
    role: "teacher" as const,
    base: "/teacher/progress",
    lessons: lessons.map((row) => ({ value: row.id, label: `${formatDate(row.date)}${row.topic ? ` — ${row.topic}` : ""}` })),
    tests: tests.map((row) => ({ value: row.id, label: `${row.name} (${formatDate(row.date)})` })),
  };
  return (
    <>
      <PageHeader
        back={report ? { href: `/teacher/progress/class?section=${pair.sectionId}&subject=${pair.subjectId}` as Route, label: `${progress.section} · ${progress.subject}` } : { href: "/teacher/progress" as Route, label: "Progress" }}
        title={report ? report.unit.title : `${progress.section} · ${progress.subject}`}
        description={report ? "Unit report" : "Your class and subject"}
      />
      {report ? <UnitReportView report={report} progress={progress} mode={mode} /> : <PairOverview progress={progress} mode={mode} />}
    </>
  );
}
