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
import { humanize } from "@/lib/format";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { TEACHER_STATUSES } from "@/lib/validation/school";
import { requireTenant } from "@/server/auth/current-user";
import { listTeachers } from "@/server/people/teachers";

export const metadata: Metadata = { title: "Teachers" };

export default async function TeachersPage(props: PageProps<"/school-admin/teachers">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const q = param(search.q);
  const status = enumParam(search.status, TEACHER_STATUSES);

  const { rows, total, page, pageCount } = await listTeachers(ctx, {
    q,
    status,
    page: pageParam(search.page),
  });

  return (
    <>
      <PageHeader
        title="Teachers"
        actions={
          <Button asChild>
            <Link href="/school-admin/teachers/new">Add teacher</Link>
          </Button>
        }
      />

      <FilterBar
        action="/school-admin/teachers"
        search={{ defaultValue: q, placeholder: "Name, employee ID or email" }}
        selects={[
          {
            name: "status",
            label: "Status",
            defaultValue: status,
            allLabel: "Any status",
            options: TEACHER_STATUSES.map((value) => ({ value, label: humanize(value) })),
          },
        ]}
      />

      {rows.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teacher</TableHead>
                <TableHead>Subjects</TableHead>
                <TableHead className="hidden md:table-cell">Class teacher of</TableHead>
                <TableHead className="hidden lg:table-cell">Contact</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((teacher) => (
                <TableRow key={teacher.id}>
                  <TableCell>
                    <Link href={`/school-admin/teachers/${teacher.id}`} className="font-medium hover:underline">
                      {teacher.firstName} {teacher.lastName}
                    </Link>
                    <p className="text-muted-foreground text-xs">{teacher.employeeId}</p>
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal">
                    {[...new Set(teacher.assignments.map((a) => a.subject.name))].join(", ") || (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {teacher.classTeacherOf.map((s) => `${s.class.name} – ${s.name}`).join(", ") || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell">
                    {teacher.email}
                    {teacher.phone ? <p className="text-xs">{teacher.phone}</p> : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={teacher.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No teachers match"
          action={
            <Button asChild size="sm">
              <Link href="/school-admin/teachers/new">Add a teacher</Link>
            </Button>
          }
        />
      )}

      <Pager page={page} pageCount={pageCount} total={total} basePath="/school-admin/teachers" params={{ q, status }} />
    </>
  );
}
