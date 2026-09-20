import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteSectionAction } from "@/features/school/academics-actions";
import { EditSectionForm } from "@/features/school/academics-forms";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getSection, listStreams, sectionLabel } from "@/server/academics/structure";
import { orNotFound } from "@/server/page-helpers";
import { teacherOptions } from "@/server/people/teachers";

export const metadata: Metadata = { title: "Section" };

export default async function SectionPage(props: PageProps<"/admin/academics/sections/[sectionId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { sectionId } = await props.params;

  const [section, streams, teachers] = await Promise.all([
    orNotFound(getSection(ctx, sectionId)),
    listStreams(ctx, { activeOnly: true }),
    teacherOptions(ctx),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: `/admin/academics/classes?session=${section.academicSession.id}`, label: "Classes & sections" }}
        title={sectionLabel(section)}
        description={`${section.academicSession.name} · ${section.enrollments.length}${section.capacity ? ` of ${section.capacity}` : ""} students`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/timetable?section=${section.id}`}>Timetable</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/attendance?section=${section.id}`}>Attendance</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Students</CardTitle>
          </CardHeader>
          <CardContent>
            {section.enrollments.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Roll</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Admission no.</TableHead>
                    <TableHead>Gender</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.enrollments.map((enrollment) => (
                    <TableRow key={enrollment.id}>
                      <TableCell className="tabular-nums">{enrollment.rollNumber ?? "—"}</TableCell>
                      <TableCell>
                        <Link href={`/admin/students/${enrollment.student.id}`} className="font-medium hover:underline">
                          {enrollment.student.firstName} {enrollment.student.lastName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{enrollment.student.admissionNumber}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {enrollment.student.gender ? humanize(enrollment.student.gender) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No students yet"
                action={
                  <Button asChild size="sm">
                    <Link href="/admin/students/new">Add a student</Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Section details</CardTitle>
            </CardHeader>
            <CardContent>
              <EditSectionForm
                section={{
                  id: section.id,
                  name: section.name,
                  streamId: section.streamId,
                  capacity: section.capacity,
                  classTeacherId: section.classTeacherId,
                }}
                streams={streams.map((stream) => ({ value: stream.id, label: stream.name }))}
                teachers={teachers}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Subject teachers</CardTitle>
              <CardDescription>Assign subjects from each teacher&apos;s page.</CardDescription>
            </CardHeader>
            <CardContent>
              {section.teacherAssignments.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {section.teacherAssignments.map((assignment) => (
                    <li key={assignment.id} className="flex justify-between gap-3">
                      <span>{assignment.subject.name}</span>
                      <Link href={`/admin/teachers/${assignment.teacher.id}`} className="text-muted-foreground hover:underline">
                        {assignment.teacher.firstName} {assignment.teacher.lastName}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No subject teachers yet.</p>
              )}
            </CardContent>
          </Card>

          {section.enrollments.length === 0 && section.teacherAssignments.length === 0 ? (
            <ActionButton
              action={deleteSectionAction}
              fields={{ sectionId: section.id }}
              variant="destructive"
              className="w-fit"
              confirm={{
                title: "Delete this section?",
                description: "Only empty sections can be deleted. This cannot be undone.",
                confirmLabel: "Delete",
              }}
            >
              Delete section
            </ActionButton>
          ) : null}
        </div>
      </div>
    </>
  );
}
