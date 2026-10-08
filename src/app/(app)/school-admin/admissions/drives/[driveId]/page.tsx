import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pauseAssignmentAction, removeAssignmentAction } from "@/features/admissions/drive-actions";
import { AssignmentForm, DriveForm, ExtendAssignmentForm, ReassignForm } from "@/features/admissions/drive-forms";
import { APPLICATION_STATUS_LABEL } from "@/features/admissions/enquiry-bits";
import { ADMISSION_TASKS, ASSIGNMENT_STATE_LABEL, DRIVE_STATE_LABEL } from "@/lib/admission-drives";
import { formatDate, toDateInput } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { listAcademicSessions } from "@/server/academics/structure";
import { assignmentOptions, getDrive } from "@/server/admissions/drives";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Admission drive" };

const STATE_TONE = { OPEN: "positive", NOT_STARTED: "neutral", EXPIRED: "neutral", PAUSED: "warning", REMOVED: "negative", DRIVE_STOPPED: "warning" } as const;
const TASK_SHORT = Object.fromEntries(ADMISSION_TASKS.map((task) => [task.key, task.label])) as Record<string, string>;

/**
 * One drive: its dates and status, the teacher assignments (each with its
 * own dates, capacity and permissions — change, pause, extend, remove),
 * moving pending applications between assignments, and every application
 * entered in it.
 */
export default async function AdmissionDrivePage(props: PageProps<"/school-admin/admissions/drives/[driveId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { driveId } = await props.params;
  const drive = await orNotFound(getDrive(ctx, driveId));
  const [sessions, options] = await Promise.all([listAcademicSessions(ctx), assignmentOptions(ctx, drive.academicSessionId)]);
  const teachers = options.teachers.map((teacher) => ({ value: teacher.id, label: `${fullName(teacher)} (${teacher.employeeId})` }));
  const editable = drive.status !== "CLOSED" && drive.status !== "CANCELLED";
  const label = new Map(drive.assignments.map((row) => [row.id, `${row.label} · ${fullName(row.teacher)}`]));
  const toReview = drive.applications.filter((row) => ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED"].includes(row.status)).length;

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/admissions/drives" as Route, label: "Admission drives" }}
        title={drive.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={drive.state} label={DRIVE_STATE_LABEL[drive.state]} />
            <span>
              {drive.academicSession.name} · {formatDate(drive.startDate)} – {formatDate(drive.endDate)}
            </span>
            {toReview ? <span>· {toReview} waiting for your review</span> : null}
          </span>
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Teacher assignments</CardTitle>
            <CardDescription>
              Each class or section has its own teacher, dates and capacity. When a teacher&apos;s end date passes they can no longer add or change applications; they
              can still see them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {drive.assignments.length ? (
              <ul className="divide-y">
                {drive.assignments.map((row) => (
                  <li key={row.id} className={`flex flex-col gap-3 py-4 ${row.removedAt ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{row.label}</span>
                      <span className="text-sm">{fullName(row.teacher)}</span>
                      <StatusBadge status={row.state} label={ASSIGNMENT_STATE_LABEL[row.state]} tone={STATE_TONE[row.state]} />
                      <span className="text-muted-foreground text-sm">
                        {formatDate(row.startDate)} – {formatDate(row.endDate)}
                      </span>
                      <span className={`text-sm tabular-nums ${row.used >= row.capacity ? "text-danger font-semibold" : ""}`}>
                        {row.used} / {row.capacity} places
                      </span>
                      {row.pending ? <span className="text-muted-foreground text-sm">· {row.pending} pending</span> : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {row.permissions.length ? (
                        row.permissions.map((task) => (
                          <span key={task} className="bg-muted rounded-full px-2 py-0.5 text-xs">
                            {TASK_SHORT[task]}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">No permissions</span>
                      )}
                    </div>
                    {!row.removedAt && editable ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <ActionButton action={pauseAssignmentAction} fields={{ assignmentId: row.id, paused: row.pausedAt ? "" : "on" }} variant="outline">
                          {row.pausedAt ? "Resume" : "Pause"}
                        </ActionButton>
                        <ActionButton
                          action={removeAssignmentAction}
                          fields={{ assignmentId: row.id }}
                          variant="ghost"
                          confirm={{
                            title: "Remove this assignment?",
                            description: `${fullName(row.teacher)} loses admission access for ${row.label} at once. Its ${row.used} application(s) are kept${row.pending ? "; move the pending ones to another teacher below" : ""}.`,
                            confirmLabel: "Remove",
                          }}
                        >
                          Remove
                        </ActionButton>
                        <ExtendAssignmentForm assignmentId={row.id} endDate={toDateInput(row.endDate)} max={toDateInput(drive.endDate)} />
                      </div>
                    ) : null}
                    {!row.removedAt && editable ? (
                      <details className="rounded-lg border p-3">
                        <summary className="cursor-pointer text-sm font-medium">Change teacher, dates, capacity or permissions</summary>
                        <div className="mt-4">
                          <AssignmentForm
                            driveId={drive.id}
                            classes={options.classes}
                            teachers={teachers}
                            defaults={{ startDate: toDateInput(drive.startDate), endDate: toDateInput(drive.endDate) }}
                            assignment={{
                              id: row.id,
                              classId: row.classId,
                              sectionId: row.sectionId,
                              teacherId: row.teacherId,
                              startDate: toDateInput(row.startDate),
                              endDate: toDateInput(row.endDate),
                              capacity: row.capacity,
                              permissions: row.permissions,
                            }}
                          />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No classes assigned yet.</p>
            )}
          </CardContent>
        </Card>

        <div className="grid items-start gap-6 xl:grid-cols-2">
          {editable ? (
            <Card>
              <CardHeader>
                <CardTitle>Assign a class to a teacher</CardTitle>
                <CardDescription>Leave the section blank for the whole class. The teacher&apos;s dates must fall inside the drive&apos;s dates.</CardDescription>
              </CardHeader>
              <CardContent>
                <AssignmentForm
                  driveId={drive.id}
                  classes={options.classes}
                  teachers={teachers}
                  defaults={{ startDate: toDateInput(drive.startDate), endDate: toDateInput(drive.endDate) }}
                />
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-col gap-6">
            {drive.assignments.some((row) => row.pending > 0) ? (
              <Card>
                <CardHeader>
                  <CardTitle>Reassign pending applications</CardTitle>
                  <CardDescription>Moves every application not yet admitted or rejected. Numbers, documents and history stay with each application.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReassignForm
                    assignments={drive.assignments.map((row) => ({ id: row.id, label: label.get(row.id)!, classId: row.classId, pending: row.pending, removed: !!row.removedAt }))}
                  />
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Drive details</CardTitle>
              </CardHeader>
              <CardContent>
                <DriveForm
                  sessions={sessions.map((session) => ({ value: session.id, label: session.name }))}
                  drive={{
                    id: drive.id,
                    academicSessionId: drive.academicSessionId,
                    name: drive.name,
                    startDate: toDateInput(drive.startDate),
                    endDate: toDateInput(drive.endDate),
                    status: drive.status,
                    notes: drive.notes,
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Applications in this drive</CardTitle>
            <CardDescription>Open one to approve, send back for correction, or reject. Approved ones go on to the usual admission.</CardDescription>
          </CardHeader>
          <CardContent>
            {drive.applications.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Child</TableHead>
                    <TableHead>Parent</TableHead>
                    <TableHead>Class · teacher</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drive.applications.map((application) => (
                    <TableRow key={application.id}>
                      <TableCell>
                        <Link href={`/school-admin/admissions/${application.id}` as Route} className="font-medium hover:underline">
                          {application.studentFirstName} {application.studentLastName}
                        </Link>
                        <span className="text-muted-foreground block font-mono text-xs">{application.applicationNumber}</span>
                      </TableCell>
                      <TableCell>
                        {application.parentName}
                        <span className="text-muted-foreground block text-xs">{application.parentPhone}</span>
                      </TableCell>
                      <TableCell>{application.assignmentId ? label.get(application.assignmentId) : application.requestedClass.name}</TableCell>
                      <TableCell>
                        <StatusBadge status={application.status} label={APPLICATION_STATUS_LABEL[application.status]} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm">No applications yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
