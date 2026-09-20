import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { unassignSubjectAction } from "@/features/school/people-actions";
import {
  AssignSubjectForm,
  EditTeacherForm,
  ResetPortalPasswordForm,
} from "@/features/school/people-forms";
import { formatDateTime, toDateInput } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { listSubjects, sectionLabel, sectionOptions } from "@/server/academics/structure";
import { orNotFound } from "@/server/page-helpers";
import { getTeacherProfile } from "@/server/people/teachers";

export const metadata: Metadata = { title: "Teacher" };

export default async function TeacherPage(props: PageProps<"/admin/teachers/[teacherId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { teacherId } = await props.params;

  const { teacher, session, periodsPerWeek } = await orNotFound(getTeacherProfile(ctx, teacherId));
  const [subjects, sections] = await Promise.all([
    listSubjects(ctx, { activeOnly: true }),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
  ]);

  const assignments = [...teacher.assignments].sort(
    (a, b) => a.section.class.level - b.section.class.level || a.subject.name.localeCompare(b.subject.name),
  );

  return (
    <>
      <PageHeader
        back={{ href: "/admin/teachers", label: "Teachers" }}
        title={`${teacher.firstName} ${teacher.lastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={teacher.status} />
            <span>
              {teacher.employeeId} · {pluralize(periodsPerWeek, "period")} a week
            </span>
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/timetable?teacher=${teacher.id}`}>Timetable</Link>
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Subjects taught{session ? ` in ${session.name}` : ""}</CardTitle>
              <CardDescription>
                A teacher can mark attendance only for sections listed here or
                where they are class teacher.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {assignments.length ? (
                <ul className="divide-y rounded-lg border">
                  {assignments.map((assignment) => (
                    <li key={assignment.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span>
                        <span className="font-medium">{assignment.subject.name}</span> ·{" "}
                        <Link href={`/admin/academics/sections/${assignment.section.id}`} className="hover:underline">
                          {sectionLabel(assignment.section)}
                        </Link>
                      </span>
                      <ActionButton
                        action={unassignSubjectAction}
                        fields={{ assignmentId: assignment.id }}
                        variant="ghost"
                        size="xs"
                        confirm={{
                          title: "Remove this assignment?",
                          description: "The teacher will lose access to this section unless they are its class teacher.",
                          confirmLabel: "Remove",
                        }}
                      >
                        Remove
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No subjects assigned yet.</p>
              )}

              {teacher.classTeacherOf.length ? (
                <p className="text-sm">
                  Class teacher of{" "}
                  {teacher.classTeacherOf.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 ? ", " : ""}
                      <Link href={`/admin/academics/sections/${s.id}`} className="font-medium hover:underline">
                        {s.class.name} – {s.name}
                      </Link>
                    </span>
                  ))}
                  .
                </p>
              ) : null}

              {session && sections.length ? (
                <AssignSubjectForm
                  teacherId={teacher.id}
                  subjects={subjects.map((s) => ({ value: s.id, label: s.name }))}
                  sections={sections}
                />
              ) : (
                <p className="text-muted-foreground text-sm">Create sections for the current session to assign subjects.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sign-in</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p>
                {teacher.user.email}
                {teacher.user.isActive ? null : <StatusBadge status="INACTIVE" label="Disabled" className="ml-2" />}
              </p>
              <p className="text-muted-foreground text-xs">Last sign-in {formatDateTime(teacher.user.lastLoginAt)}</p>
              <ResetPortalPasswordForm userId={teacher.user.id} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <EditTeacherForm
              teacher={{
                teacherId: teacher.id,
                firstName: teacher.firstName,
                lastName: teacher.lastName,
                gender: teacher.gender,
                employeeId: teacher.employeeId,
                phone: teacher.phone,
                qualification: teacher.qualification,
                joiningDate: teacher.joiningDate ? toDateInput(teacher.joiningDate) : "",
                status: teacher.status,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
