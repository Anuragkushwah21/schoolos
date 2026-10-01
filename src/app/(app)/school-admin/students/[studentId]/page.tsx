import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { LifecyclePanel } from "@/features/people/lifecycle-panel";
import { supportForStudent } from "@/server/support/service";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteStudentAction, unlinkGuardianAction } from "@/features/school/people-actions";
import {
  EditParentForm,
  EnrollmentForm,
  LinkGuardianForm,
  LoginStatus,
  PortalAccessForm,
  ResetPortalPasswordForm,
} from "@/features/school/people-forms";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatPercent, humanize } from "@/lib/format";
import { PersonPhoto } from "@/components/shared/person-photo";
import { requireTenant } from "@/server/auth/current-user";
import { photoUrlFor } from "@/server/people/photos";
import { listAcademicSessions, sectionLabel } from "@/server/academics/structure";
import { orNotFound } from "@/server/page-helpers";
import { getStudentProfile, searchParents } from "@/server/people/students";
import { activationEmailStatuses } from "@/server/auth/account-links";
import { groupLabel, seatOptionsFor } from "@/server/academics/streams";

export const metadata: Metadata = { title: "Student" };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children || "—"}</dd>
    </div>
  );
}

export default async function StudentPage(props: PageProps<"/school-admin/students/[studentId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { studentId } = await props.params;

  const [{ student, attendance }, sessions, parents] = await Promise.all([
    orNotFound(getStudentProfile(ctx, studentId)),
    listAcademicSessions(ctx),
    searchParents(ctx),
  ]);

  // Whether each pending login's activation email went, and if not, why.
  const invites = await activationEmailStatuses(ctx, [student.user?.id, ...student.parents.map((link) => link.parent.user?.id)]);

  const sectionsBySession = await ctx.db.section.findMany({
    where: { academicSessionId: { in: sessions.map((s) => s.id) } },
    select: {
      id: true,
      name: true,
      academicSessionId: true,
      class: { select: { name: true, level: true } },
      stream: { select: { name: true } },
    },
  });
  const sectionOptions = sectionsBySession
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((section) => ({ value: section.id, label: sectionLabel(section), sessionId: section.academicSessionId }));

  const current = student.enrollments.find((e) => e.academicSession.isCurrent);
  const seats = await seatOptionsFor(ctx.db, sectionsBySession.map((section) => section.id));
  const counts = Object.fromEntries(attendance.map((row) => [row.status, row._count._all]));
  const marked = attendance.reduce((sum, row) => sum + row._count._all, 0);
  const attended = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
  const support = await supportForStudent(ctx, student.id);
  const linkedParentIds = new Set(student.parents.map((link) => link.parent.id));

  const photoUrl = await photoUrlFor(ctx, { type: "STUDENT", id: student.id });

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/students", label: "Students" }}
        title={`${student.firstName} ${student.lastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={student.status} />
            <span>
              {student.admissionNumber}
              {current ? ` · ${groupLabel(current.section, current.stream)}${current.rollNumber ? `, roll ${current.rollNumber}` : ""}` : " · not placed this session"}
            </span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/school-admin/students/${student.id}/edit` as Route}>Edit details</Link>
            </Button>
            {/* Refused by the service once this child has a register, a remark
                or a result behind them, which is why the dialog says what it
                will and will not do rather than simply asking twice. */}
            <ActionButton
              action={deleteStudentAction}
              fields={{ studentId: student.id }}
              variant="ghost"
              size="default"
              confirm={{
                title: `Delete ${student.firstName} ${student.lastName}?`,
                description:
                  "This erases the student record, their placement, their parent links and any sign-in. It only works for a child admitted by mistake — once they appear in a register, or have a remark or a result, the delete is refused and you should set their status to Transferred or Graduated instead.",
                confirmLabel: "Delete",
              }}
            >
              Delete (added by mistake)
            </ActionButton>
          </>
        }
      />
      <div className="mb-6">
        <PersonPhoto name={`${student.firstName} ${student.lastName}`} photoUrl={photoUrl} who="The student" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Attendance this session</CardTitle>
              <CardDescription>
                {marked ? `${formatPercent(attended, marked)} attended across ${marked} marked days.` : "No attendance marked yet."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const).map((status) => (
                  <div key={status} className="rounded-lg border p-3">
                    <dt className="text-muted-foreground text-xs">{humanize(status)}</dt>
                    <dd className="text-xl font-semibold tabular-nums">{counts[status] ?? 0}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Academic support</CardTitle>
              <Button asChild size="sm" variant="outline">
                <Link href={`/school-admin/support/new?student=${student.id}` as Route}>+ Add support</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {support.length ? (
                <ul className="divide-y text-sm">
                  {support.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <span className="min-w-0 flex-1">
                        <Link href={`/school-admin/support/${row.id}` as Route} className="font-medium hover:underline">
                          {row.subject ?? "General"}
                          {row.topic ? ` — ${row.topic}` : ""}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {humanize(row.reason)} → {humanize(row.action)}
                          {row.teacher ? ` · ${row.teacher}` : ""}
                          {row.fromConcern ? " · from a parent's concern" : ""}
                          {row.followUps ? ` · ${row.followUps} follow-ups` : ""}
                        </span>
                      </span>
                      <StatusBadge status={row.priority} />
                      <StatusBadge status={row.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No academic support recorded. Teachers add it when a student needs extra help.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Parents &amp; guardians</CardTitle>
              <CardDescription>A guardian with a login sees all of their linked children.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {student.parents.map((link) => (
                <div key={link.id} className="flex flex-col gap-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 font-medium">
                        {link.parent.firstName} {link.parent.lastName}
                        {link.isPrimary ? <StatusBadge status="ACTIVE" label="Primary" tone="info" /> : null}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {humanize(link.relationship)} · {link.parent.phone}
                        {link.parent.email ? ` · ${link.parent.email}` : ""}
                      </p>
                    </div>
                    <ActionButton
                      action={unlinkGuardianAction}
                      fields={{ linkId: link.id }}
                      variant="ghost"
                      size="xs"
                      confirm={{
                        title: "Unlink this guardian?",
                        description: "Their record is kept, but they will no longer see this child.",
                        confirmLabel: "Unlink",
                      }}
                    >
                      Unlink
                    </ActionButton>
                  </div>

                  {link.parent.user ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div>
                        <LoginStatus user={link.parent.user} invite={invites.get(link.parent.user.id)} />
                        <p className="text-muted-foreground text-xs">Last sign-in {formatDateTime(link.parent.user.lastLoginAt)}</p>
                      </div>
                      <ResetPortalPasswordForm userId={link.parent.user.id} pending={!link.parent.user.activatedAt} />
                    </div>
                  ) : (
                    <PortalAccessForm kind="parent" personId={link.parent.id} defaultEmail={link.parent.email} />
                  )}

                  <details className="text-sm">
                    <summary className="text-muted-foreground cursor-pointer">Edit guardian details</summary>
                    <div className="mt-3">
                      <EditParentForm
                        parent={{
                          id: link.parent.id,
                          firstName: link.parent.firstName,
                          lastName: link.parent.lastName,
                          phone: link.parent.phone,
                          email: link.parent.email,
                          occupation: link.parent.occupation,
                          addressLine: link.parent.addressLine,
                          idProof: { type: link.parent.idProofType, number: link.parent.idProofNumber },
                        }}
                      />
                    </div>
                  </details>
                </div>
              ))}

              <details className="rounded-lg border border-dashed p-4" open={student.parents.length === 0}>
                <summary className="cursor-pointer text-sm font-medium">Link a guardian</summary>
                <div className="mt-4">
                  <LinkGuardianForm
                    studentId={student.id}
                    parents={parents
                      .filter((p) => !linkedParentIds.has(p.id))
                      .map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName} · ${p.phone}` }))}
                  />
                </div>
              </details>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <LifecyclePanel ctx={ctx} person="STUDENT" personId={student.id} />
          <Card>
            <CardHeader>
              <CardTitle>Placement</CardTitle>
              <CardDescription>One placement per session; earlier years are kept.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {student.enrollments.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {student.enrollments.map((enrollment) => (
                    <li key={enrollment.id} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{enrollment.academicSession.name}</span> ·{" "}
                        {groupLabel(enrollment.section, enrollment.stream)}
                        {enrollment.rollNumber ? `, roll ${enrollment.rollNumber}` : ""}
                      </span>
                      <StatusBadge status={enrollment.status} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <EnrollmentForm
                studentId={student.id}
                sessions={sessions.map((s) => ({ value: s.id, label: s.isCurrent ? `${s.name} (current)` : s.name }))}
                sections={sectionOptions}
                defaults={{
                  sessionId: current?.academicSession.id ?? sessions.find((s) => s.isCurrent)?.id,
                  sectionId: current?.section.id,
                  streamId: current?.streamId,
                  rollNumber: current?.rollNumber,
                }}
                seats={seats}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Student login</CardTitle>
              <CardDescription>Lets the student see their timetable, attendance and notices.</CardDescription>
            </CardHeader>
            <CardContent>
              {student.user ? (
                <div className="flex flex-col gap-3 text-sm">
                  <LoginStatus user={student.user} invite={invites.get(student.user.id)} />
                  <p className="text-muted-foreground text-xs">Last sign-in {formatDateTime(student.user.lastLoginAt)}</p>
                  <ResetPortalPasswordForm userId={student.user.id} pending={!student.user.activatedAt} />
                </div>
              ) : current && current.section.class.level < 6 ? (
                // Nursery to Class 5: no student account; the parent's login covers them.
                <p className="text-muted-foreground text-sm">
                  {current.section.class.name} students do not have their own login. Their parent&apos;s login shows everything.
                </p>
              ) : student.status === "ACTIVE" ? (
                <PortalAccessForm kind="student" personId={student.id} />
              ) : (
                <p className="text-muted-foreground text-sm">Only active students can be given a login.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <Detail label="Gender">{student.gender ? humanize(student.gender) : null}</Detail>
                <Detail label="Date of birth">{student.dateOfBirth ? formatDate(student.dateOfBirth) : null}</Detail>
                <Detail label="Admitted">{student.admissionDate ? formatDate(student.admissionDate) : null}</Detail>
                <Detail label="Blood group">{student.bloodGroup}</Detail>
                <Detail label="Address">
                  {[student.addressLine, student.city, student.state, student.postalCode].filter(Boolean).join(", ")}
                </Detail>
                <Detail label="Emergency">
                  {[student.emergencyContactName, student.emergencyContactPhone].filter(Boolean).join(" · ")}
                </Detail>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
