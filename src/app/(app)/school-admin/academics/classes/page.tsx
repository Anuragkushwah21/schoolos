import { BookOpenIcon } from "lucide-react";
import type { Route } from "next";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteClassAction, toggleClassAction } from "@/features/school/academics-actions";
import { CreateSectionForm, EditClassForm, InlineCreateForm } from "@/features/school/academics-forms";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import {
  listAcademicSessions,
  listClassesWithSections,
  listStreams,
  resolveSession,
} from "@/server/academics/structure";
import { seatPlans } from "@/server/academics/streams";
import { teacherOptions } from "@/server/people/teachers";

export const metadata: Metadata = { title: "Classes & sections" };

export default async function ClassesPage(props: PageProps<"/school-admin/academics/classes">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;

  const session = await resolveSession(ctx, param(search.session));
  const back = { href: "/school-admin/academics" as Route, label: "Academics" };

  if (!session) {
    return (
      <>
        <SetupNotice title="Classes & sections" need="session" back={back} />
      </>
    );
  }

  const [sessions, classes, streams, teachers] = await Promise.all([
    listAcademicSessions(ctx),
    listClassesWithSections(ctx, session.id),
    listStreams(ctx, { activeOnly: true }),
    teacherOptions(ctx),
  ]);

  const activeClasses = classes.filter((klass) => klass.isActive);
  // Each section's stream shares, for the "Science 15 · Commerce 10" line.
  const plans = await seatPlans(ctx.db, classes.flatMap((klass) => klass.sections.map((section) => section.id)));

  return (
    <>
      <PageHeader icon={BookOpenIcon} tone="blue"
        back={back}
        title="Classes & sections"
        description={`Sections for the ${session.name} session${session.isCurrent ? " (current)" : ""}.`}
      />

      <FilterBar
        action="/school-admin/academics/classes"
        selects={[
          {
            name: "session",
            label: "Academic session",
            defaultValue: session.id,
            options: sessions.map((s) => ({ value: s.id, label: s.isCurrent ? `${s.name} (current)` : s.name })),
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid content-start gap-3 sm:grid-cols-2">
          {classes.map((klass) => (
            <div
              key={klass.id}
              className={`rounded-xl border p-4 ${klass.isActive ? "" : "bg-muted/40"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={`font-medium ${klass.isActive ? "" : "text-muted-foreground"}`}>
                  {klass.name}
                  {klass.isActive ? null : <span className="ml-2 text-xs font-normal">(not offered)</span>}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <ActionButton
                    action={toggleClassAction}
                    fields={{ targetId: klass.id, active: klass.isActive ? "false" : "true" }}
                    variant="ghost"
                    size="xs"
                  >
                    {klass.isActive ? "Stop offering" : "Offer this class"}
                  </ActionButton>
                  <ActionButton
                    action={deleteClassAction}
                    fields={{ classId: klass.id }}
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    pendingLabel="Deleting…"
                    confirm={{
                      title: `Delete ${klass.name}?`,
                      description:
                        "Only a class that has never had sections, students, admissions or notices can be deleted. To retire a class that has been used, choose “Stop offering” — its history is kept.",
                      confirmLabel: "Delete class",
                    }}
                  >
                    Delete
                  </ActionButton>
                </div>
              </div>

              <details className="mt-2 text-sm">
                <summary className="text-muted-foreground cursor-pointer text-xs">Edit class</summary>
                <div className="mt-3">
                  <EditClassForm klass={{ id: klass.id, name: klass.name, level: klass.level }} />
                </div>
              </details>

              {klass.sections.length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {klass.sections.map((section) => (
                    <li key={section.id}>
                      <Link
                        href={`/school-admin/academics/sections/${section.id}`}
                        className="hover:border-primary flex flex-col rounded-lg border px-3 py-2 text-sm transition-colors"
                      >
                        <span className="font-medium">
                          Section {section.name}
                          {section.stream ? ` · ${section.stream.name}` : ""}
                        </span>
                        {section.capacity !== null ? (
                          <span
                            className={`text-xs font-semibold tabular-nums ${section._count.enrollments >= section.capacity ? "text-danger-strong" : "text-success-strong"}`}
                          >
                            {section._count.enrollments >= section.capacity
                              ? "Full"
                              : `${section.capacity - section._count.enrollments} seats left`}
                          </span>
                        ) : null}
                        <span className="text-muted-foreground text-xs">
                          {section._count.enrollments}
                          {section.capacity ? ` / ${section.capacity}` : ""} students
                          {section.classTeacher
                            ? ` · ${section.classTeacher.firstName} ${section.classTeacher.lastName}`
                            : " · no class teacher"}
                        </span>
                        {plans.get(section.id)?.allocations.length ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {plans.get(section.id)!.allocations.map((row) => (
                              <span
                                key={row.streamId}
                                className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${row.full ? "bg-warning-soft text-warning-strong" : "bg-info-soft text-info-strong"}`}
                              >
                                {row.name} {row.occupied}/{row.capacity}
                              </span>
                            ))}
                            {plans.get(section.id)!.unallocated ? (
                              <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[11px] tabular-nums">{plans.get(section.id)!.unallocated} unallocated</span>
                            ) : null}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : klass.isActive ? (
                <p className="text-muted-foreground mt-2 text-xs">No sections this session.</p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Add a section</CardTitle>
              <CardDescription>For {session.name}.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateSectionForm
                academicSessionId={session.id}
                classes={activeClasses.map((klass) => ({ value: klass.id, label: klass.name }))}
                streams={streams.map((stream) => ({ value: stream.id, label: stream.name }))}
                teachers={teachers}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add a class</CardTitle>
              <CardDescription>Nursery to Class 12 exist already; add others here.</CardDescription>
            </CardHeader>
            <CardContent>
              <InlineCreateForm kind="class" />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
