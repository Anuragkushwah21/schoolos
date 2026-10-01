import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { LifecyclePanel } from "@/features/people/lifecycle-panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteTeacherAction, unassignSubjectAction } from "@/features/school/people-actions";
import {
  AssignSubjectForm,
  EditTeacherForm,
  LoginStatus,
  ResetPortalPasswordForm,
} from "@/features/school/people-forms";
import { removeSalaryAction } from "@/features/finance/actions";
import { SalaryForm } from "@/features/finance/forms";
import { rupees, toRupeeInput } from "@/features/finance/money";
import { formatDate, formatDateTime, toDateInput, today } from "@/lib/dates";
import { humanize, pluralize } from "@/lib/format";
import { PersonPhoto } from "@/components/shared/person-photo";
import { requireTenant } from "@/server/auth/current-user";
import { photoUrlFor } from "@/server/people/photos";
import { type AdmissionSeatOptions, admissionSeatOptions, groupLabel } from "@/server/academics/streams";
import { classSectionOptions, listSubjects } from "@/server/academics/structure";
import { orNotFound } from "@/server/page-helpers";
import { getTeacherSalary } from "@/server/finance/salary";
import { getTeacherProfile } from "@/server/people/teachers";
import { activationEmailStatuses } from "@/server/auth/account-links";

export const metadata: Metadata = { title: "Teacher" };

export default async function TeacherPage(props: PageProps<"/school-admin/teachers/[teacherId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { teacherId } = await props.params;

  const { teacher, session, periodsPerWeek } = await orNotFound(getTeacherProfile(ctx, teacherId));
  const [subjects, sections, salary, seats] = await Promise.all([
    listSubjects(ctx, { activeOnly: true }),
    session ? classSectionOptions(ctx, session.id) : Promise.resolve([]),
    getTeacherSalary(ctx, teacherId),
    session ? admissionSeatOptions(ctx, session.id) : Promise.resolve({} as AdmissionSeatOptions),
  ]);
  // The streams each section shares its seats with, for "whole section or one stream".
  const streamsBySection = Object.fromEntries(Object.entries(seats).map(([sectionId, plan]) => [sectionId, plan.streams.map((stream) => ({ value: stream.value, label: stream.name }))]));

  const assignments = [...teacher.assignments].sort(
    (a, b) => a.section.class.level - b.section.class.level || a.subject.name.localeCompare(b.subject.name),
  );

  const [photoUrl, invites] = await Promise.all([
    photoUrlFor(ctx, { type: "TEACHER", id: teacher.id }),
    activationEmailStatuses(ctx, [teacher.user.id]),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/teachers", label: "Teachers" }}
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
          <>
            <Button asChild variant="outline">
              <Link href={`/school-admin/timetable?teacher=${teacher.id}`}>Timetable</Link>
            </Button>
            {/* Refused by the service once this teacher has any record in the
                school, which is why the dialog says what it will and will not
                do rather than simply asking twice. */}
            <ActionButton
              action={deleteTeacherAction}
              fields={{ teacherId: teacher.id }}
              variant="ghost"
              size="default"
              confirm={{
                title: `Delete ${teacher.firstName} ${teacher.lastName}?`,
                description:
                  "This erases the staff record and the sign-in together. It only works for someone added by mistake — once they have taken a register, taught a period or set homework, the delete is refused and you should use Change status (for example Resigned) instead.",
                confirmLabel: "Delete",
              }}
            >
              Delete (added by mistake)
            </ActionButton>
          </>
        }
      />
      <div className="mb-6">
        <PersonPhoto name={`${teacher.firstName} ${teacher.lastName}`} photoUrl={photoUrl} who="The teacher" />
      </div>

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
                        <Link href={`/school-admin/academics/sections/${assignment.section.id}`} className="hover:underline">
                          {groupLabel(assignment.section, assignment.stream)}
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
                      <Link href={`/school-admin/academics/sections/${s.id}`} className="font-medium hover:underline">
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
                  streamsBySection={streamsBySection}
                />
              ) : (
                <p className="text-muted-foreground text-sm">Add a class under Academics, or set a current session, to assign subjects.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sign-in</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <LoginStatus user={teacher.user} invite={invites.get(teacher.user.id)} />
              <p className="text-muted-foreground text-xs">Last sign-in {formatDateTime(teacher.user.lastLoginAt)}</p>
              <ResetPortalPasswordForm userId={teacher.user.id} pending={!teacher.user.activatedAt} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <LifecyclePanel ctx={ctx} person="TEACHER" personId={teacher.id} />
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Salary</CardTitle>
                <CardDescription>
                  Only you and {teacher.firstName} can see this. Never required to add a teacher.
                </CardDescription>
              </div>
              {salary.current ? (
                <StatusBadge status="ACTIVE" label="Configured" />
              ) : (
                <StatusBadge status="PENDING" label="Not set" />
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {salary.current ? (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Detail label="Salary" value={`${rupees(salary.current.amountMinor)} ${humanize(salary.current.salaryType).toLowerCase()}`} />
                  <Detail label="Net" value={rupees(salary.current.netMinor)} />
                  <Detail label="Allowances" value={rupees(salary.current.allowancesMinor)} />
                  <Detail label="Deductions" value={rupees(salary.current.deductionsMinor)} />
                  <Detail label="Effective from" value={formatDate(salary.current.effectiveFrom)} />
                </dl>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No salary recorded. A teacher works without one — this is the school&apos;s
                  employment record, not a requirement for adding them.
                </p>
              )}

              {salary.history.length > 1 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">History</p>
                  <ul className="divide-y rounded-lg border">
                    {salary.history.map((row) => (
                      <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                        <span className="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">
                          {formatDate(row.effectiveFrom)}
                        </span>
                        <span className="min-w-0 flex-1 tabular-nums">{rupees(row.amountMinor)}</span>
                        {row.current ? <StatusBadge status="ACTIVE" label="Current" /> : null}
                        {row.effectiveFrom > today() ? (
                          <StatusBadge status="PENDING" label="Scheduled" />
                        ) : null}
                        <ActionButton
                          action={removeSalaryAction}
                          fields={{ salaryId: row.id }}
                          variant="ghost"
                          size="xs"
                          pendingLabel="Removing…"
                          confirm={{
                            title: "Remove this salary record?",
                            description:
                              "The figure before it becomes current again. Use this for a row entered by mistake.",
                            confirmLabel: "Remove",
                          }}
                        >
                          Remove
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <SalaryForm
                teacherId={teacher.id}
                today={toDateInput(today())}
                current={
                  salary.current
                    ? {
                        salaryType: salary.current.salaryType,
                        amountRupees: toRupeeInput(salary.current.amountMinor),
                        allowancesRupees: toRupeeInput(salary.current.allowancesMinor),
                        deductionsRupees: toRupeeInput(salary.current.deductionsMinor),
                      }
                    : undefined
                }
              />
            </CardContent>
          </Card>

          <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <EditTeacherForm
              teacher={{
                teacherId: teacher.id,
                email: teacher.user.email,
                firstName: teacher.firstName,
                lastName: teacher.lastName,
                gender: teacher.gender,
                employeeId: teacher.employeeId,
                phone: teacher.phone,
                qualification: teacher.qualification,
                joiningDate: teacher.joiningDate ? toDateInput(teacher.joiningDate) : "",
                status: teacher.status,
                designation: teacher.designation,
                dateOfBirth: teacher.dateOfBirth ? toDateInput(teacher.dateOfBirth) : "",
                addressLine: teacher.addressLine,
                city: teacher.city,
                state: teacher.state,
                postalCode: teacher.postalCode,
              }}
            />
          </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm tabular-nums">{value}</dd>
    </div>
  );
}
