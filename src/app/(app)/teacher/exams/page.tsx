import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardListIcon, FilePenLineIcon, HourglassIcon, PlusIcon, SendIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Button } from "@/components/ui/button";
import { TestsTable } from "@/features/exams/tests-table";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { listMyTests } from "@/server/exams/service";

export const metadata: Metadata = { title: "My tests" };

/**
 * Exams & Tests → My Tests. Tests this teacher set, and exam papers for the
 * subjects they teach. Status runs Upcoming → Enter marks → Draft saved →
 * Submitted → Published.
 */
export default async function TeacherExamsPage(props: PageProps<"/teacher/exams">) {
  const ctx = await requireTenant("TEACHER");
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="Exams & Tests" />;
  const search = await props.searchParams;
  const tests = await listMyTests(ctx);
  const view = param(search.view);
  const todo = tests.filter((row) => row.stage === "ENTER_MARKS" || row.stage === "DRAFT");
  const shown = view === "todo" ? todo : view === "done" ? tests.filter((row) => row.stage === "SUBMITTED" || row.stage === "PUBLISHED") : view === "upcoming" ? tests.filter((row) => row.stage === "UPCOMING") : tests;

  return (
    <>
      <PageHeader
        icon={ClipboardListIcon}
        tone="purple"
        title="My tests"
        description="Create a test, enter marks as a draft, then submit the results. Submitted test results reach students and parents."
        actions={
          <Button asChild>
            <Link href="/teacher/exams/new">
              <PlusIcon aria-hidden />
              Create test
            </Link>
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="amber" icon={FilePenLineIcon} label="Marks to enter" value={todo.length} href="/teacher/exams?view=todo" />
        <StatCard tone="blue" icon={HourglassIcon} label="Upcoming tests" value={tests.filter((row) => row.stage === "UPCOMING").length} href="/teacher/exams?view=upcoming" />
        <StatCard tone="green" icon={SendIcon} label="Submitted" value={tests.filter((row) => row.stage === "SUBMITTED" || row.stage === "PUBLISHED").length} href="/teacher/exams?view=done" />
        <StatCard tone="purple" icon={ClipboardListIcon} label="All tests" value={tests.length} href="/teacher/exams" />
      </div>
      <ViewTabs
        label="Filter tests"
        tabs={[
          { href: "/teacher/exams", label: "All", count: tests.length, active: !view },
          { href: "/teacher/exams?view=todo", label: "Marks to enter", count: todo.length, active: view === "todo" },
          { href: "/teacher/exams?view=upcoming", label: "Upcoming", active: view === "upcoming" },
          { href: "/teacher/exams?view=done", label: "Submitted", active: view === "done" },
        ]}
      />
      {shown.length ? (
        <TestsTable rows={shown} hrefFor={(row) => `/teacher/exams/${row.id}`} />
      ) : (
        <EmptyState
          icon={ClipboardListIcon}
          tone="purple"
          title={tests.length ? "Nothing here" : "No tests yet"}
          action={
            <Button asChild>
              <Link href="/teacher/exams/new">Create test</Link>
            </Button>
          }
        >
          {tests.length ? "Try another filter." : "Create a test for a subject you teach. Exam papers set by the school office appear here too."}
        </EmptyState>
      )}
    </>
  );
}
