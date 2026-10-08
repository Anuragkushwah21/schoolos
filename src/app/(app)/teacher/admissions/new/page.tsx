import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DriveApplicationForm } from "@/features/admissions/drive-forms";
import { param } from "@/lib/search-params";
import { myAdmissionWork, streamOptionsFor } from "@/server/admissions/drives";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New application" };

/** A teacher starts an application in one of their open assignments. The service checks it all again. */
export default async function NewTeacherAdmissionPage(props: PageProps<"/teacher/admissions/new">) {
  const ctx = await requireTenant("TEACHER");
  const assignmentId = param((await props.searchParams).assignment);
  const { assignments } = await myAdmissionWork(ctx);
  const assignment = assignments.find((row) => row.id === assignmentId);
  if (!assignment) notFound();
  const streams = await streamOptionsFor(ctx, assignment.class.level);

  return (
    <>
      <PageHeader
        back={{ href: "/teacher/admissions" as Route, label: "Admissions" }}
        title="New application"
        description={`${assignment.label} · ${assignment.drive.name} · ${assignment.used} of ${assignment.capacity} places used`}
      />
      <Card>
        <CardContent className="pt-6">
          {assignment.can.create ? (
            <DriveApplicationForm assignmentId={assignment.id} streams={streams} />
          ) : (
            <p className="text-muted-foreground text-sm">You cannot add applications to this class right now.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
