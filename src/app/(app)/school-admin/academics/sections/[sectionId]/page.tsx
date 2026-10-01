import type { Metadata } from "next";
import Link from "next/link";
import { ArmchairIcon, UserCheckIcon, UsersIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteSectionAction } from "@/features/school/academics-actions";
import {
  EditSectionForm,
  StreamAllocationForm,
} from "@/features/school/academics-forms";
import { humanize, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireTenant } from "@/server/auth/current-user";
import { seatPlan } from "@/server/academics/streams";
import {
  getSection,
  listStreams,
  sectionLabel,
} from "@/server/academics/structure";
import { orNotFound } from "@/server/page-helpers";
import { photoUrlsFor } from "@/server/people/photos";
import { teacherOptions } from "@/server/people/teachers";

export const metadata: Metadata = { title: "Section" };

export default async function SectionPage(
  props: PageProps<"/school-admin/academics/sections/[sectionId]">,
) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { sectionId } = await props.params;

  const [section, allStreams, teachers, plan] = await Promise.all([
    orNotFound(getSection(ctx, sectionId)),
    listStreams(ctx),
    teacherOptions(ctx),
    orNotFound(seatPlan(ctx.db, sectionId)),
  ]);
  const shared = plan.allocations.length > 0;
  const photos = await photoUrlsFor(
    ctx,
    "STUDENT",
    section.enrollments.map((row) => row.student.id),
  );
  const admitted = section.enrollments.length;
  const remaining =
    section.capacity !== null ? section.capacity - admitted : null;
  const classLabel = section.class.name;
  const streams = allStreams.filter((stream) => stream.isActive);
  // A stream switched off later still shows on the shares that use it.
  const allocationStreams = allStreams.filter(
    (stream) =>
      stream.isActive ||
      plan.allocations.some((row) => row.streamId === stream.id),
  );

  return (
    <>
      <PageHeader
        back={{
          href: `/school-admin/academics/classes?session=${section.academicSession.id}`,
          label: "Classes & sections",
        }}
        title={sectionLabel(section)}
        description={`${section.academicSession.name}${section.stream ? ` · ${section.stream.name} stream` : ""}${section.classTeacher ? ` · Class teacher ${section.classTeacher.firstName} ${section.classTeacher.lastName}` : " · No class teacher"}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/school-admin/timetable?section=${section.id}`}>
                Timetable
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/school-admin/attendance?section=${section.id}`}>
                Attendance
              </Link>
            </Button>
          </>
        }
      />

      {/* ---------------- seats at a glance ---------------- */}
      <section aria-label="Seats" className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total seats"
          value={section.capacity ?? "—"}
          hint={
            section.capacity === null
              ? "No capacity set — edit the section to add one"
              : "Section capacity"
          }
          icon={ArmchairIcon}
          tone="blue"
        />
        <StatCard
          label="Admitted"
          value={admitted}
          hint={pluralize(admitted, "current student")}
          icon={UserCheckIcon}
          tone="green"
        />
        <StatCard
          label="Remaining seats"
          value={remaining === null ? "—" : Math.max(remaining, 0)}
          hint={
            remaining === null
              ? "Unlimited until a capacity is set"
              : remaining < 0
                ? `Over capacity by ${-remaining}`
                : remaining === 0
                  ? "Section is full"
                  : "Seats still free"
          }
          icon={UsersIcon}
          tone={remaining !== null && remaining <= 0 ? "red" : "orange"}
        />
      </section>

      {shared ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Seats by stream</CardTitle>
            <CardDescription>
              Each stream&apos;s share of this section&apos;s seats.
              {plan.unallocated
                ? ` ${plan.unallocated} seats are not given to any stream.`
                : ""}
              {plan.outsideAllocations
                ? ` ${pluralize(plan.outsideAllocations, "student")} have no stream share here.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {plan.allocations.map((row) => (
                <li key={row.streamId} className="rounded-xl border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{row.name}</span>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        row.full ? "text-danger-strong" : "text-success-strong",
                      )}
                    >
                      {row.full ? "Full" : `${row.remaining} left`}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm tabular-nums">
                    {row.occupied} admitted of {row.capacity} seats
                  </p>
                  <div
                    className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full"
                    aria-hidden
                  >
                    <div
                      className={cn(
                        "h-full rounded-full",
                        row.full ? "bg-danger" : "bg-primary",
                      )}
                      style={{
                        width: `${row.capacity ? Math.min((row.occupied / row.capacity) * 100, 100) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- who is in it ---------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Students ({admitted})</CardTitle>
          <CardDescription>
            Everyone currently admitted to {sectionLabel(section)}, by roll
            number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {admitted ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Roll</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Admission no.</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Stream</TableHead>
                  <TableHead>Gender</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {section.enrollments.map((enrollment) => {
                  const name = `${enrollment.student.firstName} ${enrollment.student.lastName}`;
                  // A shared section records each student's stream; a one-stream section is that stream.
                  const stream =
                    enrollment.stream?.name ?? section.stream?.name ?? null;
                  return (
                    <TableRow key={enrollment.id}>
                      <TableCell className="tabular-nums">
                        {enrollment.rollNumber ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/school-admin/students/${enrollment.student.id}`}
                          className="flex items-center gap-2.5 font-medium hover:underline"
                        >
                          <PersonAvatar
                            name={name}
                            photoUrl={photos.get(enrollment.student.id)}
                          />
                          {name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {enrollment.student.admissionNumber}
                      </TableCell>
                      <TableCell>{classLabel}</TableCell>
                      <TableCell>{section.name}</TableCell>
                      <TableCell>
                        {stream ??
                          (shared ? (
                            <span className="text-warning-strong text-xs">
                              Not set
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          ))}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {enrollment.student.gender
                          ? humanize(enrollment.student.gender)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No students yet"
              action={
                <Button asChild size="sm">
                  <Link href="/school-admin/students/new">Add a student</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <>
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
                streams={streams.map((stream) => ({
                  value: stream.id,
                  label: stream.name,
                }))}
                teachers={teachers}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Streams / groups &amp; seats</CardTitle>
              <CardDescription>
                {plan.capacity !== null
                  ? `Capacity ${plan.capacity} · ${plan.occupied} enrolled · ${Math.max(plan.capacity - plan.occupied, 0)} free`
                  : `${plan.occupied} enrolled · no capacity set`}
                {plan.outsideAllocations
                  ? ` · ${plan.outsideAllocations} without a stream here`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StreamAllocationForm
                key={plan.allocations
                  .map((row) => `${row.streamId}:${row.capacity}`)
                  .join("|")}
                sectionId={section.id}
                capacity={plan.capacity}
                wholeStream={plan.wholeStream?.name ?? null}
                streams={allocationStreams.map((stream) => ({
                  value: stream.id,
                  label: stream.isActive ? stream.name : `${stream.name} (off)`,
                }))}
                current={plan.allocations.map((row) => ({
                  streamId: row.streamId,
                  capacity: row.capacity,
                  occupied: row.occupied,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Subject teachers</CardTitle>
              <CardDescription>
                Assign subjects from each teacher&apos;s page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {section.teacherAssignments.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {section.teacherAssignments.map((assignment) => (
                    <li
                      key={assignment.id}
                      className="flex justify-between gap-3"
                    >
                      <span>
                        {assignment.subject.name}
                        <span className="text-muted-foreground">
                          {" "}
                          ·{" "}
                          {assignment.stream?.name ??
                            (shared ? "All streams" : "Whole section")}
                        </span>
                      </span>
                      <Link
                        href={`/school-admin/teachers/${assignment.teacher.id}`}
                        className="text-muted-foreground hover:underline"
                      >
                        {assignment.teacher.firstName}{" "}
                        {assignment.teacher.lastName}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No subject teachers yet.
                </p>
              )}
            </CardContent>
          </Card>

          {section.enrollments.length === 0 &&
          section.teacherAssignments.length === 0 ? (
            <ActionButton
              action={deleteSectionAction}
              fields={{ sectionId: section.id }}
              variant="destructive"
              className="w-fit"
              confirm={{
                title: "Delete this section?",
                description:
                  "Only empty sections can be deleted. This cannot be undone.",
                confirmLabel: "Delete",
              }}
            >
              Delete section
            </ActionButton>
          ) : null}
        </>
      </div>
    </>
  );
}
