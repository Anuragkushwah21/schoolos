import type { Route } from "next";
import Link from "next/link";
import { ClipboardListIcon, PlusIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { param } from "@/lib/search-params";
import { listClasses, listStreams, listSubjects, requireCurrentSession, sectionOptions } from "@/server/academics/structure";
import type { TenantContext } from "@/server/auth/current-user";
import { listTests, type TestFilters } from "@/server/exams/service";
import { teacherOptions } from "@/server/people/teachers";

import { TestsTable } from "./tests-table";

type Search = Record<string, string | string[] | undefined>;

/**
 * School Admin → Exams & Results: one screen for All Tests, Pending Marks and
 * Published Results, filtered by class, section, stream, subject, teacher and
 * test name.
 */
export async function AdminTestsScreen({ ctx, view, base, search, emptyTitle, emptyText }: { ctx: TenantContext; view: TestFilters["view"]; base: string; search: Search; emptyTitle: string; emptyText: string }) {
  const session = await requireCurrentSession(ctx);
  const filters: TestFilters = {
    view,
    classId: param(search.class),
    sectionId: param(search.section),
    streamId: param(search.stream),
    subjectId: param(search.subject),
    teacherId: param(search.teacher),
    q: param(search.q),
  };
  const [rows, classes, sections, streams, subjects, teachers] = await Promise.all([
    listTests(ctx, filters),
    listClasses(ctx, { activeOnly: true }),
    sectionOptions(ctx, session.id),
    listStreams(ctx),
    listSubjects(ctx),
    teacherOptions(ctx),
  ]);

  return (
    <>
      <FilterBar
        action={base}
        search={{ name: "q", defaultValue: filters.q, placeholder: "Test name" }}
        selects={[
          { name: "class", label: "Class", defaultValue: filters.classId, allLabel: "All classes", options: classes.map((row) => ({ value: row.id, label: row.name })) },
          { name: "section", label: "Section", defaultValue: filters.sectionId, allLabel: "All sections", options: sections },
          { name: "stream", label: "Stream", defaultValue: filters.streamId, allLabel: "All streams", options: streams.map((row) => ({ value: row.id, label: row.name })), advanced: true },
          { name: "subject", label: "Subject", defaultValue: filters.subjectId, allLabel: "All subjects", options: subjects.map((row) => ({ value: row.id, label: row.name })) },
          { name: "teacher", label: "Teacher", defaultValue: filters.teacherId, allLabel: "All teachers", options: teachers, advanced: true },
        ]}
      />
      {rows.length ? (
        <TestsTable rows={rows} showTeacher hrefFor={(row) => `/school-admin/exams/papers/${row.id}`} />
      ) : (
        <EmptyState
          icon={ClipboardListIcon}
          tone="purple"
          title={emptyTitle}
          action={
            <Button asChild variant="outline">
              <Link href={"/school-admin/exams/new" as Route}>
                <PlusIcon aria-hidden />
                Create term exam
              </Link>
            </Button>
          }
        >
          {emptyText}
        </EmptyState>
      )}
    </>
  );
}
