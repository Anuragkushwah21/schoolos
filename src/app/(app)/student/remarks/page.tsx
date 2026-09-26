import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentTabs } from "@/features/student/nav";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyRemarks } from "@/server/student/me";

export const metadata: Metadata = { title: "Teacher remarks" };

/** What this student's teachers have observed. Read-only — a student cannot edit one. */
export default async function StudentRemarksPage() {
  const ctx = await requireTenant("STUDENT");
  const { me, entries } = await orNotFound(getMyRemarks(ctx));

  return (
    <>
      <PageHeader
        title="Teacher remarks"
        description={`${me.placement.sectionLabel} · ${me.placement.sessionName}`}
      />
      <StudentTabs active="remarks" />

      {entries.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Observations</CardTitle>
            <CardDescription>Newest first, from the teachers who teach you.</CardDescription>
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
          Your teachers record how you are getting on as the term goes. What they write appears here.
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
