import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  setCurrentSessionAction,
  toggleStreamAction,
  toggleSubjectAction,
} from "@/features/school/academics-actions";
import { AcademicSessionForm, InlineCreateForm } from "@/features/school/academics-forms";
import { addDays, formatDate, toDateInput } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { currentAcademicYear } from "@/server/academics/provision";
import { listAcademicSessions, listStreams, listSubjects } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Academics" };

export default async function AcademicsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");

  const [sessions, streams, subjects] = await Promise.all([
    listAcademicSessions(ctx),
    listStreams(ctx),
    listSubjects(ctx),
  ]);

  // Suggest the session after the latest one, so creating next year is one click.
  const latest = sessions[0];
  const suggestionStart = latest ? addDays(latest.endDate, 1) : currentAcademicYear().startDate;
  const suggestion = {
    name: `${suggestionStart.getUTCFullYear()}-${String((suggestionStart.getUTCFullYear() + 1) % 100).padStart(2, "0")}`,
    startDate: toDateInput(suggestionStart),
    endDate: toDateInput(addDays(new Date(Date.UTC(suggestionStart.getUTCFullYear() + 1, suggestionStart.getUTCMonth(), suggestionStart.getUTCDate())), -1)),
  };

  return (
    <>
      <PageHeader
        title="Academics"
        description="Sessions, classes, sections, streams and subjects."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/school-admin/academics/class-teachers">Class teachers</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/school-admin/academics/promotion">Student promotion</Link>
            </Button>
            <Button asChild>
              <Link href="/school-admin/academics/classes">Classes & sections</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="xl:row-span-2">
          <CardHeader>
            <CardTitle>Academic sessions</CardTitle>
            <CardDescription>
              Sections, enrollments, timetables and attendance belong to a
              session. Exactly one is current.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <ul className="divide-y rounded-lg border">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="flex items-center gap-2 font-medium">
                      {session.name}
                      {session.isCurrent ? <StatusBadge status="ACTIVE" label="Current" /> : null}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatDate(session.startDate)} – {formatDate(session.endDate)} ·{" "}
                      {pluralize(session._count.sections, "section")} ·{" "}
                      {pluralize(session._count.enrollments, "enrollment")}
                    </p>
                  </div>
                  {session.isCurrent ? null : (
                    <ActionButton
                      action={setCurrentSessionAction}
                      fields={{ sessionId: session.id }}
                      variant="outline"
                      confirm={{
                        title: `Make ${session.name} the current session?`,
                        description:
                          "Dashboards, new admissions, timetables and attendance will switch to this session. Nothing in other sessions is changed.",
                        confirmLabel: "Make current",
                      }}
                    >
                      Make current
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">New session</p>
              <AcademicSessionForm suggestion={suggestion} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subjects</CardTitle>
            <CardDescription>Disabled subjects stay on past records but cannot be newly assigned.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <ul className="flex flex-wrap gap-2">
              {subjects.map((subject) => (
                <li
                  key={subject.id}
                  className="flex items-center gap-2 rounded-full border py-1 pr-1 pl-3 text-sm"
                >
                  <span className={subject.isActive ? "" : "text-muted-foreground line-through"}>
                    {subject.name} <span className="text-muted-foreground text-xs">{subject.code}</span>
                  </span>
                  <ActionButton
                    action={toggleSubjectAction}
                    fields={{ targetId: subject.id, active: subject.isActive ? "false" : "true" }}
                    variant="ghost"
                    size="xs"
                  >
                    {subject.isActive ? "Disable" : "Enable"}
                  </ActionButton>
                </li>
              ))}
            </ul>
            <InlineCreateForm kind="subject" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Streams</CardTitle>
            <CardDescription>Optional specialisations for senior classes.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <ul className="flex flex-wrap gap-2">
              {streams.map((stream) => (
                <li
                  key={stream.id}
                  className="flex items-center gap-2 rounded-full border py-1 pr-1 pl-3 text-sm"
                >
                  <span className={stream.isActive ? "" : "text-muted-foreground line-through"}>{stream.name}</span>
                  <ActionButton
                    action={toggleStreamAction}
                    fields={{ targetId: stream.id, active: stream.isActive ? "false" : "true" }}
                    variant="ghost"
                    size="xs"
                  >
                    {stream.isActive ? "Disable" : "Enable"}
                  </ActionButton>
                </li>
              ))}
            </ul>
            <InlineCreateForm kind="stream" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
