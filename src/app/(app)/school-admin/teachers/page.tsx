import { UserCogIcon, PlusIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { PersonAvatar } from "@/components/shared/person-avatar";
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
import { formatDate } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { photoUrlsFor } from "@/server/people/photos";
import { BulkDocumentsPanel, BulkRowCheckbox } from "@/features/documents/forms";
import { bulkDocumentOptions } from "@/server/documents/service";
import { leavingDates } from "@/server/people/lifecycle";
import { listTeachers } from "@/server/people/teachers";

export const metadata: Metadata = { title: "Teachers" };

export default async function TeachersPage(props: PageProps<"/school-admin/teachers">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const search = await props.searchParams;
  const q = param(search.q);
  // Current teachers by default; former ones stay one filter away.
  const statusParam = param(search.status);
  const status = enumParam(search.status, TEACHER_STATUSES) ?? (statusParam === "ALL" ? undefined : "CURRENT");

  const { rows, total, page, pageCount } = await listTeachers(ctx, {
    q,
    status,
    page: pageParam(search.page),
  });

  const [leftOn, photos, bulkTypes] = await Promise.all([leavingDates(ctx, "TEACHER", rows), photoUrlsFor(ctx, "TEACHER", rows.map((row) => row.id)), bulkDocumentOptions(ctx, "TEACHER")]);

  return (
    <>
      <PageHeader icon={UserCogIcon} tone="purple"
        title="Teachers"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/school-admin/teachers/import">Import CSV</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={"/school-admin/reports/export?kind=teachers" as Route} prefetch={false}>
                Export CSV
              </Link>
            </Button>
            <Button asChild>
              <Link href="/school-admin/teachers/new">
                <PlusIcon aria-hidden />
                Add teacher
              </Link>
            </Button>
          </>
        }
      />

      <FilterBar
        action="/school-admin/teachers"
        search={{ defaultValue: q, placeholder: "Name, employee ID or email" }}
        selects={[
          {
            name: "status",
            label: "Status",
            defaultValue: statusParam ?? "CURRENT",
            options: [
              { value: "CURRENT", label: "Current (active or on leave)" },
              ...TEACHER_STATUSES.map((value) => ({ value, label: humanize(value) })),
              { value: "ALL", label: "Any status, including former" },
            ],
          },
        ]}
      />

      {rows.length ? (
        <BulkDocumentsPanel kind="TEACHER" types={bulkTypes}>
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <span className="sr-only">Select</span>
                </TableHead>
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
                    <BulkRowCheckbox id={teacher.id} label={`${teacher.firstName} ${teacher.lastName}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <PersonAvatar name={`${teacher.firstName} ${teacher.lastName}`} photoUrl={photos.get(teacher.id)} fallbackClassName="bg-purple-soft text-purple-strong" />
                      <div className="min-w-0">
                        <Link href={`/school-admin/teachers/${teacher.id}`} className="font-medium hover:underline">
                          {teacher.firstName} {teacher.lastName}
                        </Link>
                        <p className="text-muted-foreground text-xs">{teacher.employeeId}</p>
                      </div>
                    </div>
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
                    {leftOn.get(teacher.id) ? <span className="text-muted-foreground mt-1 block text-xs">Left {formatDate(leftOn.get(teacher.id))}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </BulkDocumentsPanel>
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

      <Pager page={page} pageCount={pageCount} total={total} basePath="/school-admin/teachers" params={{ q, status: statusParam }} />
    </>
  );
}
