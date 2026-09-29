import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MATERIAL_KIND_LABEL, MaterialActions } from "@/features/student/material-actions";
import { StudentTabs } from "@/features/student/nav";
import { formatDate } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyHomeworkItem } from "@/server/student/me";

export const metadata: Metadata = { title: "Homework" };

const STATE = {
  OVERDUE: { label: "Overdue", tone: "negative" },
  DUE_TODAY: { label: "Due today", tone: "warning" },
  PENDING: { label: "Pending", tone: "neutral" },
} as const;

/**
 * One assignment in full: what to do, and what to use.
 *
 * `getMyHomeworkItem` is the guard — published work for the student's own
 * section only. The resources are the teacher's, for the student to use; there
 * is no submission in this version, so nothing here is sent back.
 */
export default async function StudentHomeworkItemPage(
  props: PageProps<"/student/homework/[homeworkId]">,
) {
  const ctx = await requireTenant("STUDENT");
  const { homeworkId } = await props.params;
  const { homework } = await orNotFound(getMyHomeworkItem(ctx, homeworkId));
  const state = STATE[homework.state];

  return (
    <>
      <PageHeader
        back={{ href: "/student/homework", label: "Homework" }}
        title={homework.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={homework.state} label={state.label} tone={state.tone} />
            {homework.subject} · {homework.teacher} · {homework.section}
          </span>
        }
      />
      <StudentTabs active="homework" />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
              <CardDescription>
                Set {formatDate(homework.assignedOn)} · due {formatDate(homework.dueOn)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {homework.instructions ? (
                <p className="text-sm whitespace-pre-line">{homework.instructions}</p>
              ) : null}
              {homework.description ? (
                <p className="text-muted-foreground text-sm whitespace-pre-line">
                  {homework.description}
                </p>
              ) : null}
              {!homework.instructions && !homework.description ? (
                <p className="text-muted-foreground text-sm">
                  Your teacher has not added instructions beyond the title.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Study resources</CardTitle>
            <CardDescription>From your teacher, to help with this homework.</CardDescription>
          </CardHeader>
          <CardContent>
            {homework.resources.length ? (
              <ul className="flex flex-col gap-3">
                {homework.resources.map((resource) => (
                  <li key={resource.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{resource.title}</p>
                      <StatusBadge
                        status="INACTIVE"
                        label={MATERIAL_KIND_LABEL[resource.kind] ?? resource.kind}
                        tone="neutral"
                      />
                    </div>
                    {resource.description ? (
                      <p className="text-muted-foreground mt-1 text-sm">{resource.description}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <MaterialActions material={resource} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No study resources attached.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
