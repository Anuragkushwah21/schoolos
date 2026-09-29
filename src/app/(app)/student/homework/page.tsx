import { NotebookPenIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentTabs } from "@/features/student/nav";
import { formatDate } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyHomework } from "@/server/student/me";

export const metadata: Metadata = { title: "Homework" };

/**
 * What has been set, grouped by what it means tonight.
 *
 * There is no submission or completion tracking in this version, so nothing here
 * claims to know what has been done — marking work as handed in would be a new
 * feature with a teacher side to it, not a display change. Each entry opens
 * the full assignment, with its instructions and study resources.
 */
export default async function StudentHomeworkPage() {
  const ctx = await requireTenant("STUDENT");
  const data = await orNotFound(getMyHomework(ctx));

  const groups = [
    { title: "Overdue", description: "Past its due date.", entries: data.overdue },
    { title: "Due today", description: "Needs to go in today.", entries: data.dueToday },
    { title: "Due soon", description: "Within the next three days.", entries: data.dueSoon },
    { title: "Later", description: "Set, with time in hand.", entries: data.upcoming },
    { title: "Earlier", description: "Older than a fortnight.", entries: data.past },
  ];

  const outstanding = data.overdue.length + data.dueToday.length + data.dueSoon.length;

  return (
    <>
      <PageHeader icon={NotebookPenIcon} tone="purple"
        title="Homework"
        description={`${data.me.placement.sectionLabel} · set by your teachers`}
      />
      <StudentTabs active="homework" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Needs attention" value={outstanding} hint="overdue or due within 3 days" />
        <StatCard label="Overdue" value={data.overdue.length} />
        <StatCard label="Due today" value={data.dueToday.length} />
        <StatCard label="Set for later" value={data.upcoming.length} />
      </div>

      {groups.every((group) => group.entries.length === 0) ? (
        <EmptyState title="No homework set yet">
          Work your teachers set for your class appears here as soon as they publish it.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {groups
            .filter((group) => group.entries.length > 0)
            .map((group) => (
              <Card key={group.title}>
                <CardHeader>
                  <CardTitle>
                    {group.title} · {pluralize(group.entries.length, "assignment")}
                  </CardTitle>
                  <CardDescription>{group.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {group.entries.map((entry) => (
                      <li key={entry.id} className="flex flex-col gap-1 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <Link
                            href={`/student/homework/${entry.id}` as Route}
                            className="text-sm font-medium hover:underline"
                          >
                            {entry.subject} — {entry.title}
                          </Link>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            due {formatDate(entry.dueOn)}
                          </span>
                        </div>
                        {entry.description ? (
                          <p className="text-sm whitespace-pre-line">{entry.description}</p>
                        ) : null}
                        <p className="text-muted-foreground text-xs">
                          Set {formatDate(entry.assignedOn)} by {entry.teacher}
                          {entry.resourceCount
                            ? ` · ${pluralize(entry.resourceCount, "study resource")}`
                            : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </>
  );
}
