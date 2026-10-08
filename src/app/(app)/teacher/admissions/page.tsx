import type { Metadata, Route } from "next";
import Link from "next/link";
import { UserPlusIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APPLICATION_STATUS_LABEL } from "@/features/admissions/enquiry-bits";
import { ADMISSION_TASKS, ASSIGNMENT_STATE_LABEL } from "@/lib/admission-drives";
import { formatDate } from "@/lib/dates";
import { myAdmissionWork } from "@/server/admissions/drives";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Admissions" };

const STATE_TONE = { OPEN: "positive", NOT_STARTED: "neutral", EXPIRED: "neutral", PAUSED: "warning", REMOVED: "negative", DRIVE_STOPPED: "warning" } as const;

/**
 * A teacher's admission work: the classes the School Admin gave them in an
 * admission drive — their dates, places left and what they may do — and the
 * applications on them. Nothing of any other teacher's.
 */
export default async function TeacherAdmissionsPage() {
  const ctx = await requireTenant("TEACHER");
  const { assignments, applications } = await orNotFound(myAdmissionWork(ctx));
  const where = new Map(assignments.map((row) => [row.id, row.label]));

  return (
    <>
      <PageHeader
        icon={UserPlusIcon}
        tone="blue"
        title="Admissions"
        description="Enter applications for the classes the School Admin gave you, add documents and submit. The School Admin approves and admits."
      />

      {assignments.length ? (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {assignments.map((row) => (
            <Card key={row.id} size="sm">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {row.label}
                  <StatusBadge status={row.state} label={ASSIGNMENT_STATE_LABEL[row.state]} tone={STATE_TONE[row.state]} />
                </CardTitle>
                <CardDescription>
                  {row.drive.name} · {row.drive.academicSession.name}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <p>
                  Your dates: {formatDate(row.startDate)} – {formatDate(row.endDate)}
                </p>
                <p className="tabular-nums">
                  {row.used} of {row.capacity} places used
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ADMISSION_TASKS.filter((task) => row.tasks.includes(task.key)).map((task) => (
                    <span key={task.key} className="bg-muted rounded-full px-2 py-0.5 text-xs">
                      {task.label}
                    </span>
                  ))}
                </div>
                {row.can.create && row.used < row.capacity ? (
                  <div>
                    <Button asChild size="sm">
                      <Link href={`/teacher/admissions/new?assignment=${row.id}` as Route}>New application</Link>
                    </Button>
                  </div>
                ) : row.state === "OPEN" && row.tasks.includes("create") ? (
                  <p className="text-muted-foreground text-xs">All places are taken.</p>
                ) : row.state !== "OPEN" ? (
                  <p className="text-muted-foreground text-xs">You can view these applications, but not add or change them.</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {applications.length ? (
        <div className="bg-card shadow-card overflow-hidden rounded-2xl border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Child</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((application) => (
                <TableRow key={application.id}>
                  <TableCell>
                    <Link href={`/teacher/admissions/${application.id}` as Route} className="font-medium hover:underline">
                      {application.studentFirstName} {application.studentLastName}
                    </Link>
                    <span className="text-muted-foreground block font-mono text-xs">{application.applicationNumber}</span>
                  </TableCell>
                  <TableCell>
                    {application.parentName}
                    <span className="text-muted-foreground block text-xs">{application.parentPhone}</span>
                  </TableCell>
                  <TableCell>{application.assignmentId ? where.get(application.assignmentId) : "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={application.status} label={application.status === "SUBMITTED" ? "Pending admin review" : APPLICATION_STATUS_LABEL[application.status]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={UserPlusIcon} tone="blue" title={assignments.length ? "No applications yet" : "No admission work"}>
          {assignments.length ? "Start one with New application." : "The School Admin has not given you any admission work."}
        </EmptyState>
      )}
    </>
  );
}
