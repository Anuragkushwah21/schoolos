import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChildTabs } from "@/features/parent/child-nav";
import { formatDate } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getChildHomework } from "@/server/parent/child";

export const metadata: Metadata = { title: "Homework" };

type Entry = {
  id: string;
  title: string;
  description: string | null;
  assignedOn: Date;
  dueOn: Date;
  subject: string;
  teacher: string;
};

/**
 * What the class has been set, grouped by what it means for tonight.
 *
 * Only published work: a teacher's draft is not homework the class has been
 * given, and showing it would have a parent chasing something that does not
 * exist. There is no completion tracking in the schema, so nothing here claims
 * to know whether the child has done it — that stays a conversation at home.
 */
export default async function ChildHomeworkPage(
  props: PageProps<"/parent/children/[studentId]/homework">,
) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const data = await orNotFound(getChildHomework(ctx, studentId));
  const { child } = data;

  const groups: Array<{ title: string; description: string; entries: Entry[] }> = [
    {
      title: "Overdue",
      description: "Past its due date and still on the list.",
      entries: data.overdue,
    },
    { title: "Due today", description: "Needs to go in today.", entries: data.dueToday },
    { title: "Due soon", description: "Within the next three days.", entries: data.dueSoon },
    { title: "Later", description: "Set, with time in hand.", entries: data.upcoming },
    { title: "Earlier", description: "Older than a fortnight.", entries: data.past },
  ];

  const outstanding = data.overdue.length + data.dueToday.length + data.dueSoon.length;

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={`${child.student.name} — homework`}
        description={`${child.placement.sectionLabel} · set by their teachers`}
      />
      <ChildTabs studentId={studentId} active="homework" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Needs attention" value={outstanding} hint="overdue or due within 3 days" />
        <StatCard label="Overdue" value={data.overdue.length} />
        <StatCard label="Due today" value={data.dueToday.length} />
        <StatCard label="Set for later" value={data.upcoming.length} />
      </div>

      {groups.every((group) => group.entries.length === 0) ? (
        <EmptyState title="No homework has been set yet">
          Work set for {child.student.name.split(" ")[0]}&apos;s class appears here as soon as a
          teacher publishes it.
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
                          <span className="text-sm font-medium">
                            {entry.subject} — {entry.title}
                          </span>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            due {formatDate(entry.dueOn)}
                          </span>
                        </div>
                        {entry.description ? (
                          <p className="text-sm whitespace-pre-line">{entry.description}</p>
                        ) : null}
                        <p className="text-muted-foreground text-xs">
                          Set {formatDate(entry.assignedOn)} by {entry.teacher}
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
