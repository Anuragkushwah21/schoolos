import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChildTabs } from "@/features/parent/child-nav";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getChildRemarks } from "@/server/parent/child";

export const metadata: Metadata = { title: "Teacher remarks" };

/**
 * What this child's teachers have observed.
 *
 * Three fixed questions, answered the same way each time, so a year of remarks
 * can be read as a pattern rather than as a stack of differently-worded notes.
 * A guardian reads them; only the teacher who wrote one can change it.
 */
export default async function ChildRemarksPage(
  props: PageProps<"/parent/children/[studentId]/remarks">,
) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const { child, entries } = await orNotFound(getChildRemarks(ctx, studentId));

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={`${child.student.name} — teacher remarks`}
        description={`${child.placement.sectionLabel} · ${child.placement.sessionName}`}
      />
      <ChildTabs studentId={studentId} active="remarks" />

      {entries.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Observations</CardTitle>
            <CardDescription>Newest first, from every teacher who teaches them.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-2 py-4">
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
                    <Band label="Academic understanding" value={entry.understanding} />
                    <Band label="Homework" value={entry.homeworkHabit} />
                    <Band label="Participation" value={entry.participation} />
                  </dl>
                  {entry.note ? <p className="text-sm whitespace-pre-line">{entry.note}</p> : null}
                  <p className="text-muted-foreground text-xs">
                    {entry.author}
                    {entry.subject ? ` · ${entry.subject}` : ""} · {formatDate(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="No remarks yet">
          Teachers record how {child.student.name.split(" ")[0]} is getting on as the term goes. What
          they write appears here.
        </EmptyState>
      )}
    </>
  );
}

function Band({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>
        {value ? (
          <StatusBadge status={value} label={humanize(value)} />
        ) : (
          <span className="text-muted-foreground text-sm">Not assessed</span>
        )}
      </dd>
    </div>
  );
}
