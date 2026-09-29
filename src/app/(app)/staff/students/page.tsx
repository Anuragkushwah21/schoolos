import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize } from "@/lib/format";
import { pageParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";
import { staffStudentDirectory } from "@/server/staff/portal";

export const metadata: Metadata = { title: "Students" };

/** Read-only student directory for staff granted VIEW_STUDENTS. */
export default async function StaffStudentsPage(props: PageProps<"/staff/students">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "VIEW_STUDENTS");
  const search = await props.searchParams;
  const filters = { q: param(search.q), page: pageParam(search.page) };
  const { rows, total, page, pageCount } = await staffStudentDirectory(ctx, filters);

  return (
    <>
      <PageHeader title="Students" description="Current students, their class and whom to contact. Read-only." />
      <FilterBar action="/staff/students" search={{ defaultValue: filters.q, placeholder: "Name or admission number" }} />
      {rows.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Guardian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground block text-xs">{row.admissionNumber}</span>
                  </TableCell>
                  <TableCell>
                    {row.section ?? "—"}
                    {row.rollNumber ? <span className="text-muted-foreground block text-xs">Roll {row.rollNumber}</span> : null}
                  </TableCell>
                  <TableCell>
                    {row.guardian ? (
                      <>
                        {row.guardian.name} <span className="text-muted-foreground text-xs">({humanize(row.guardian.relationship)})</span>
                        <span className="text-muted-foreground block text-xs tabular-nums">{row.guardian.phone}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No students match" />
      )}
      <Pager page={page} pageCount={pageCount} total={total} basePath="/staff/students" params={{ q: filters.q }} />
    </>
  );
}
