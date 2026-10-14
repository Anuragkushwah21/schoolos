import type { Metadata } from "next";
import { ClipboardPlusIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ClassTestForm } from "@/features/exams/forms";
import { mySyllabusChoices } from "@/server/academics/syllabus";
import { today, toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { myTestOptions } from "@/server/exams/service";

export const metadata: Metadata = { title: "Create test" };

/** Exams & Tests → Create Test: only for what this teacher is assigned to teach. */
export default async function CreateTestPage(props: PageProps<"/teacher/exams/new">) {
  const ctx = await requireTenant("TEACHER");
  // "?section=" from the dashboard pre-selects that class; only the teacher's own options are listed anyway.
  const sectionId = param((await props.searchParams).section);
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="Create test" />;
  const [options, syllabus] = await Promise.all([myTestOptions(ctx), mySyllabusChoices(ctx)]);

  return (
    <>
      <PageHeader
        back={{ href: "/teacher/exams", label: "My tests" }}
        icon={ClipboardPlusIcon}
        tone="purple"
        title="Create test"
        description="Choose the subject and class, name the test, and check the preview before creating it."
      />
      {options.length ? (
        <Card className="max-w-3xl">
          <CardContent>
            <ClassTestForm options={options} today={toDateInput(today())} sectionId={sectionId} syllabus={syllabus} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState icon={ClipboardPlusIcon} tone="purple" title="No subjects assigned">
          You can create tests only for subjects you are assigned to teach. Ask the school office to assign your subjects.
        </EmptyState>
      )}
    </>
  );
}
