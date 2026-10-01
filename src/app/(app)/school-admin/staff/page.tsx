import { IdCardIcon, PlusIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { MoreActions } from "@/components/shared/more-actions";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importStaffAction } from "@/features/operations/actions";
import { StaffForm } from "@/features/operations/forms";
import { CsvImportForm } from "@/features/operations/import-form";
import { formatDate } from "@/lib/dates";
import { fullName, humanize } from "@/lib/format";
import { enumParam, param } from "@/lib/search-params";
import { STAFF_ROLES, STAFF_STATUSES } from "@/lib/validation/operations";
import { requireTenant } from "@/server/auth/current-user";
import { photoUrlsFor } from "@/server/people/photos";
import { listStaff } from "@/server/operations/staff";
import { leavingDates } from "@/server/people/lifecycle";

export const metadata: Metadata = { title: "Staff" };

/** Non-teaching staff. Teachers are under Teachers; neither has documents or KYC here. */
export default async function StaffPage(props: PageProps<"/school-admin/staff">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  // Current staff by default; former staff stay one filter away.
  const statusParam = param(search.status);
  const filters = {
    q: param(search.q),
    role: enumParam(search.role, STAFF_ROLES),
    status: enumParam(search.status, STAFF_STATUSES) ?? (statusParam === "ALL" ? undefined : ("CURRENT" as const)),
  };
  const rows = await listStaff(ctx, filters);
  const [leftOn, photos] = await Promise.all([leavingDates(ctx, "STAFF", rows), photoUrlsFor(ctx, "STAFF", rows.map((row) => row.id))]);

  return (
    <>
      <PageHeader icon={IdCardIcon} tone="purple"
        title="Staff"
        description="Non-teaching staff: office, accounts, transport, library and support. Give someone a login from their page. Teachers are under Teachers."
        actions={
          <>
            <MoreActions
              items={[
                { href: "#import-staff", label: "Import from a spreadsheet" },
                { href: "/school-admin/reports/export?kind=staff", label: "Download list (CSV)", download: true },
              ]}
            />
            <Button asChild>
              <a href="#add-staff">
                <PlusIcon aria-hidden />
                Add staff
              </a>
            </Button>
          </>
        }
      />
      <FilterBar
        action="/school-admin/staff"
        search={{ defaultValue: filters.q, placeholder: "Name, employee ID or phone" }}
        selects={[
          { name: "role", label: "Designation", defaultValue: filters.role, allLabel: "Any designation", options: STAFF_ROLES.map((value) => ({ value, label: humanize(value) })) },
          {
            name: "status",
            label: "Status",
            defaultValue: statusParam ?? "CURRENT",
            options: [
              { value: "CURRENT", label: "Current (active or on leave)" },
              ...STAFF_STATUSES.map((value) => ({ value, label: humanize(value) })),
              { value: "ALL", label: "Any status, including former" },
            ],
          },
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div>
          {rows.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Designation</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Joined</th>
                    <th className="px-3 py-2 font-medium">Login</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <PersonAvatar name={fullName(row)} photoUrl={photos.get(row.id)} fallbackClassName="bg-orange-soft text-orange-strong" />
                          <div className="min-w-0">
                            <Link href={`/school-admin/staff/${row.id}` as Route} className="font-medium hover:underline">
                              {fullName(row)}
                            </Link>
                            <span className="text-muted-foreground block text-xs">{row.employeeId}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {humanize(row.role)}
                        {row.designation ? <span className="text-muted-foreground block text-xs">{row.designation}</span> : null}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{row.phone ?? "—"}</td>
                      <td className="px-3 py-2">{row.joiningDate ? formatDate(row.joiningDate) : "—"}</td>
                      <td className="text-muted-foreground px-3 py-2">{row.userId ? "Yes" : "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status} />
                        {leftOn.get(row.id) ? <span className="text-muted-foreground mt-1 block text-xs">Left {formatDate(leftOn.get(row.id))}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={filters.q || filters.role ? "No staff match these filters." : "No staff added yet."}>
              Add office, accounts, library, transport or support staff with the form on this page.
            </EmptyState>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle id="add-staff" className="scroll-mt-24">Add staff member</CardTitle>
            </CardHeader>
            <CardContent>
              <StaffForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle id="import-staff" className="scroll-mt-24">Import from CSV</CardTitle>
              <CardDescription>
                <Link href="/school-admin/reports/export?kind=template-staff" prefetch={false} className="underline">
                  Download the template
                </Link>
                . Nothing is saved unless every row is valid.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CsvImportForm action={importStaffAction} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
