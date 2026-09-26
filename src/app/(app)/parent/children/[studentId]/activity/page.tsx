import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChildTabs } from "@/features/parent/child-nav";
import { formatDate, formatMinutes } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getChildActivity } from "@/server/parent/child";

export const metadata: Metadata = { title: "Class activity" };

/**
 * What was actually taught, period by period.
 *
 * The teacher's own write-up: the topic, any note, and whether the class ran as
 * scheduled, was covered by a substitute, or was missed. This is the answer to
 * "what is my child studying?" that does not depend on asking the child.
 */
export default async function ChildActivityPage(
  props: PageProps<"/parent/children/[studentId]/activity">,
) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const search = await props.searchParams;
  const subjectId = param(search.subject);

  const { child, subjects, entries } = await orNotFound(
    getChildActivity(ctx, studentId, { subjectId, days: 60 }),
  );

  const completed = entries.filter((e) => e.status === "COMPLETED" || e.status === "REMOTE").length;

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={`${child.student.name} — class activity`}
        description={`${child.placement.sectionLabel} · last 60 days, as the teachers recorded it`}
      />
      <ChildTabs studentId={studentId} active="activity" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Classes recorded" value={entries.length} />
        <StatCard label="Completed" value={completed} />
        <StatCard label="Covered" value={entries.filter((e) => e.status === "SUBSTITUTE").length} />
        <StatCard
          label="Missed or cancelled"
          value={entries.filter((e) => e.status === "MISSED" || e.status === "CANCELLED").length}
        />
      </div>

      <FilterBar
        action={`/parent/children/${studentId}/activity`}
        selects={[
          {
            name: "subject",
            label: "Subject",
            defaultValue: subjectId,
            allLabel: "All subjects",
            options: subjects.map((subject) => ({ value: subject.id, label: subject.name })),
          },
        ]}
      />

      {entries.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Lesson by lesson</CardTitle>
            <CardDescription>Newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm tabular-nums">
                    {formatDate(entry.date)}
                    <span className="block text-xs">{formatMinutes(entry.startMinute)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {entry.subject}
                      {entry.topic ? ` — ${entry.topic}` : ""}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {entry.teacher}
                      {entry.stoodInFor ? `, covering for ${entry.stoodInFor}` : ""}
                    </span>
                    {entry.notes ? (
                      <span className="mt-1 block text-xs whitespace-pre-line">{entry.notes}</span>
                    ) : null}
                  </span>
                  <StatusBadge status={entry.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title={subjectId ? "Nothing recorded in that subject" : "No classes written up yet"}>
          Teachers write up each period after they teach it. What was taught appears here as soon as
          they do.
        </EmptyState>
      )}
    </>
  );
}
