import { GraduationCapIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { MoreActions } from "@/components/shared/more-actions";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { GENDERS, STUDENT_STATUSES } from "@/lib/validation/school";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { leavingDates } from "@/server/people/lifecycle";
import { getCurrentSession, sectionLabel, sectionOptions } from "@/server/academics/structure";
import { ParentDetailsDialog } from "@/features/school/parent-dialog";
import { listStudents } from "@/server/people/students";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage(props: PageProps<"/school-admin/students">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;

  const q = param(search.q);
  const sectionId = param(search.section);
  const classId = param(search.class);
  const gender = enumParam(search.gender, GENDERS);
  // Current students (active or on leave) by default; anyone who has left is
  // one filter away, so old records stay findable without cluttering the list.
  const status = enumParam(search.status, STUDENT_STATUSES) ?? (param(search.status) === "ALL" ? undefined : "CURRENT");
  const statusParam = param(search.status);

  const session = await getCurrentSession(ctx);
  const [{ rows, total, page, pageCount }, sections, classes] = await Promise.all([
    listStudents(ctx, { q, sectionId, classId, gender, status, page: pageParam(search.page) }),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
    ctx.db.class.findMany({ where: { isActive: true }, orderBy: { level: "asc" }, select: { id: true, name: true } }),
  ]);

  const leftOn = await leavingDates(ctx, "STUDENT", rows);

  return (
    <>
      <PageHeader icon={GraduationCapIcon} tone="blue"
        title="Students"
        description={session ? `Placements shown for ${session.name}.` : undefined}
        actions={
          <>
            <MoreActions
              items={[
                { href: "/school-admin/students/import", label: "Import from a spreadsheet" },
                { href: "/school-admin/students/bulk", label: "Promote / move / change many" },
                { href: "/school-admin/reports/export?kind=students", label: "Download list (CSV)", download: true },
              ]}
            />
            <Button asChild>
              <Link href="/school-admin/students/new">
                <PlusIcon aria-hidden />
                Add student
              </Link>
            </Button>
          </>
        }
      />

      <FilterBar
        action="/school-admin/students"
        search={{ defaultValue: q, placeholder: "Student, admission no, parent name, mobile or email" }}
        selects={[
          {
            name: "class",
            label: "Class",
            defaultValue: classId,
            allLabel: "All classes",
            options: classes.map((klass) => ({ value: klass.id, label: klass.name })),
          },
          { name: "section", label: "Section", defaultValue: sectionId, allLabel: "All sections", options: sections },
          {
            name: "status",
            label: "Status",
            defaultValue: statusParam ?? "CURRENT",
            options: [
              { value: "CURRENT", label: "Current (active or on leave)" },
              ...STUDENT_STATUSES.map((value) => ({ value, label: humanize(value) })),
              { value: "ALL", label: "Any status, including left" },
            ],
          },
          {
            name: "gender",
            label: "Gender",
            defaultValue: gender,
            allLabel: "Boys and girls",
            advanced: true,
            options: [
              { value: "MALE", label: "Boys" },
              { value: "FEMALE", label: "Girls" },
              { value: "OTHER", label: "Other" },
            ],
          },
        ]}
      />

      {rows.length ? (
        <>
        {/* Phones: one readable card per student instead of a wide table. */}
        <ul className="flex flex-col gap-3 md:hidden">
          {rows.map((student) => {
            const enrollment = student.enrollments[0];
            const guardian = student.parents[0]?.parent;
            return (
              <li key={student.id} className="bg-card rounded-2xl border p-4 shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {student.firstName} {student.lastName}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {student.admissionNumber}
                      {enrollment ? ` · ${sectionLabel(enrollment.section)}` : " · Not placed"}
                      {enrollment?.rollNumber ? ` · Roll ${enrollment.rollNumber}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={student.status} />
                </div>
                {guardian ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    {guardian.firstName} {guardian.lastName} · <span className="tabular-nums">{guardian.phone}</span>
                  </p>
                ) : null}
                <Button asChild variant="outline" className="mt-3 w-full">
                  <Link href={`/school-admin/students/${student.id}`}>View profile</Link>
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="bg-card hidden overflow-x-auto rounded-2xl border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Section</TableHead>
                <TableHead className="hidden sm:table-cell">Roll No.</TableHead>
                <TableHead className="hidden md:table-cell">Parent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((student) => {
                const enrollment = student.enrollments[0];
                const guardian = student.parents[0]?.parent;
                return (
                  <TableRow key={student.id}>
                    <TableCell>
                      <Link href={`/school-admin/students/${student.id}`} className="font-medium hover:underline">
                        {student.firstName} {student.lastName}
                      </Link>
                      <p className="text-muted-foreground text-xs">{student.admissionNumber}</p>
                    </TableCell>
                    <TableCell>{enrollment ? enrollment.section.class.name : <span className="text-muted-foreground">Not placed</span>}</TableCell>
                    <TableCell>
                      {enrollment ? `${enrollment.section.name}${enrollment.section.stream ? ` (${enrollment.section.stream.name})` : ""}` : "—"}
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">{enrollment?.rollNumber ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {guardian ? (
                        // The name opens the family: three siblings in this list
                        // are three rows, and only the dialog makes them one
                        // household.
                        <ParentDetailsDialog
                          parent={{
                            id: guardian.id,
                            name: `${guardian.firstName} ${guardian.lastName}`,
                            phone: guardian.phone,
                            email: guardian.email,
                            hasLogin: guardian.user !== null,
                            loginActive: guardian.user?.isActive ?? false,
                            children: guardian.children.map((link) => {
                              const placement = link.student.enrollments[0];
                              return {
                                id: link.student.id,
                                name: `${link.student.firstName} ${link.student.lastName}`,
                                admissionNumber: link.student.admissionNumber,
                                status: link.student.status,
                                relationship: link.relationship,
                                isPrimary: link.isPrimary,
                                sectionLabel: placement ? sectionLabel(placement.section) : null,
                                rollNumber: placement?.rollNumber ?? null,
                              };
                            }),
                          }}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {guardian ? (
                        <p className="text-muted-foreground text-xs">
                          {guardian.phone}
                          {guardian.children.length > 1
                            ? ` · ${guardian.children.length} children here`
                            : ""}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={student.status} />
                      {leftOn.get(student.id) ? <span className="text-muted-foreground mt-1 block text-xs">Left {formatDate(leftOn.get(student.id))}</span> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/school-admin/students/${student.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        </>
      ) : (
        <EmptyState
          title={q || sectionId || classId || gender || statusParam ? "No students match these filters." : "No students added yet."}
          action={
            <Button asChild size="sm">
              <Link href="/school-admin/students/new">Add a student</Link>
            </Button>
          }
        >
          Try a different search, section or status.
        </EmptyState>
      )}

      <Pager
        page={page}
        pageCount={pageCount}
        total={total}
        basePath="/school-admin/students"
        params={{ q, section: sectionId, status: statusParam }}
      />
    </>
  );
}
