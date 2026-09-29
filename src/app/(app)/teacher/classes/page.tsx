import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pluralize } from "@/lib/format";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { schoolClosureOn } from "@/server/calendar/holidays";
import { today } from "@/lib/dates";
import { getMyClasses } from "@/server/people/teacher-self";

export const metadata: Metadata = { title: "My classes" };

/**
 * The classes this teacher is responsible for.
 *
 * The list comes from the server's own idea of what they may reach, so there
 * is nothing here to filter on the client and nothing a crafted URL could add
 * to it.
 */
export default async function TeacherClassesPage() {
  const ctx = await requireTenant("TEACHER");
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="My classes" />;

  const [classes, closedToday] = await Promise.all([getMyClasses(ctx), schoolClosureOn(ctx, today())]);

  if (classes.length === 0) {
    return (
      <>
        <PageHeader title="My classes" />
        <EmptyState title="No classes assigned yet">
          Ask the school office to assign your subjects. Your classes appear here as soon as they
          do.
        </EmptyState>
      </>
    );
  }

  const pending = classes.filter((cls) => !cls.attendanceMarkedToday).length;

  return (
    <>
      <PageHeader
        title="My classes"
        description={
          closedToday
            ? `${closedToday.label} — no register is needed today.`
            : pending
              ? `${pluralize(pending, "register")} still to mark today.`
              : "Every register is marked today."
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {classes.map((cls) => (
          <Card key={cls.sectionId} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {cls.label}
                {cls.isClassTeacher ? (
                  <span className="text-muted-foreground text-xs font-normal">class teacher</span>
                ) : null}
              </CardTitle>
              <CardDescription>
                {pluralize(cls.students, "student")}
                {cls.subjects.length ? ` · ${cls.subjects.join(", ")}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex flex-wrap items-center gap-2">
              {cls.attendanceMarkedToday ? (
                <span
                  className="inline-flex items-center gap-1 text-sm"
                  style={{ color: "var(--viz-good)" }}
                >
                  <CheckIcon className="size-4" aria-hidden />
                  Attendance completed
                </span>
              ) : (
                <span className="text-sm" style={{ color: "var(--viz-warning)" }}>
                  Attendance pending
                </span>
              )}
              <div className="ms-auto flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/teacher/classes/${cls.sectionId}`}>Students</Link>
                </Button>
                <Button asChild size="sm" variant={cls.attendanceMarkedToday ? "ghost" : "default"}>
                  <Link href={`/teacher/attendance?section=${cls.sectionId}`}>
                    {cls.attendanceMarkedToday ? "Register" : "Mark"}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
