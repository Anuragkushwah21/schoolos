import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
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
import { STUDENT_STATUSES } from "@/lib/validation/school";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionLabel, sectionOptions } from "@/server/academics/structure";
import { listStudents } from "@/server/people/students";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage(props: PageProps<"/admin/students">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;

  const q = param(search.q);
  const sectionId = param(search.section);
  const status = enumParam(search.status, STUDENT_STATUSES) ?? (param(search.status) === "ALL" ? undefined : "ACTIVE");
  const statusParam = param(search.status);

  const session = await getCurrentSession(ctx);
  const [{ rows, total, page, pageCount }, sections] = await Promise.all([
    listStudents(ctx, { q, sectionId, status, page: pageParam(search.page) }),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Students"
        description={session ? `Placements shown for ${session.name}.` : undefined}
        actions={
          <Button asChild>
            <Link href="/admin/students/new">Add student</Link>
          </Button>
        }
      />

      <FilterBar
        action="/admin/students"
        search={{ defaultValue: q, placeholder: "Name or admission number" }}
        selects={[
          { name: "section", label: "Section", defaultValue: sectionId, allLabel: "All sections", options: sections },
          {
            name: "status",
            label: "Status",
            defaultValue: statusParam ?? "ACTIVE",
            options: [
              ...STUDENT_STATUSES.map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() })),
              { value: "ALL", label: "Any status" },
            ],
          },
        ]}
      />

      {rows.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="hidden md:table-cell">Primary guardian</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((student) => {
                const enrollment = student.enrollments[0];
                const guardian = student.parents[0]?.parent;
                return (
                  <TableRow key={student.id}>
                    <TableCell>
                      <Link href={`/admin/students/${student.id}`} className="font-medium hover:underline">
                        {student.firstName} {student.lastName}
                      </Link>
                      <p className="text-muted-foreground text-xs">{student.admissionNumber}</p>
                    </TableCell>
                    <TableCell>
                      {enrollment ? (
                        <>
                          {sectionLabel(enrollment.section)}
                          {enrollment.rollNumber ? (
                            <p className="text-muted-foreground text-xs">Roll {enrollment.rollNumber}</p>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not placed</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {guardian ? (
                        <>
                          {guardian.firstName} {guardian.lastName}
                          <p className="text-muted-foreground text-xs">{guardian.phone}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={student.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      {student.userId ? "Yes" : "No"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No students match"
          action={
            <Button asChild size="sm">
              <Link href="/admin/students/new">Add a student</Link>
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
        basePath="/admin/students"
        params={{ q, section: sectionId, status: statusParam }}
      />
    </>
  );
}
