import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
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
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { enumParam } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { listApplications } from "@/server/admissions/service";

export const metadata: Metadata = { title: "Admissions" };

const STATUSES = ["SUBMITTED", "UNDER_REVIEW", "WAITLISTED", "ACCEPTED", "REJECTED"] as const;

export default async function AdmissionsPage(props: PageProps<"/admin/admissions">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const status = enumParam(search.status, STATUSES);
  const applications = await listApplications(ctx, status);

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Applications from your school's website."
        actions={
          <Button asChild variant="outline">
            <Link href={`/schools/${ctx.schoolSlug}/admissions`} target="_blank">
              View the public form
            </Link>
          </Button>
        }
      />

      <FilterBar
        action="/admin/admissions"
        selects={[
          {
            name: "status",
            label: "Status",
            defaultValue: status,
            allLabel: "All applications",
            options: STATUSES.map((value) => ({ value, label: humanize(value) })),
          },
        ]}
      />

      {applications.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applicant</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="hidden md:table-cell">Guardian</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((application) => (
                <TableRow key={application.id}>
                  <TableCell>
                    <Link href={`/admin/admissions/${application.id}`} className="font-medium hover:underline">
                      {application.studentFirstName} {application.studentLastName}
                    </Link>
                    <p className="text-muted-foreground font-mono text-xs">{application.applicationNumber}</p>
                  </TableCell>
                  <TableCell>
                    {application.requestedClass.name}
                    <p className="text-muted-foreground text-xs">{application.academicSession.name}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {application.parentName}
                    <p className="text-muted-foreground text-xs">{application.parentPhone}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(application.submittedAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={application.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No applications yet">
          Applications submitted from your school website appear here.
        </EmptyState>
      )}
    </>
  );
}
