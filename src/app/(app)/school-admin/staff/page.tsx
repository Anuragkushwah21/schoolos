import { IdCardIcon, PlusIcon, UsersIcon } from "lucide-react";
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
import { listStaff, staffOverview } from "@/server/operations/staff";
import { leavingDates } from "@/server/people/lifecycle";
import { listRoleProfiles } from "@/server/staff/roles";
import { RoleProfileForm } from "@/features/staff/access-forms";
import { STAFF_ROLE_NAMES } from "@/lib/staff-access";
import { TONE_ICON } from "@/components/shared/tones";

export const metadata: Metadata = { title: "Non-teaching staff" };

/** A colour per role card, in turn. */
const ROLE_TONES = (["blue", "amber", "green", "purple", "cyan", "orange", "red"] as const).map((tone) => TONE_ICON[tone]);
const BASE_ROLE_OPTIONS = (Object.keys(STAFF_ROLE_NAMES) as Array<keyof typeof STAFF_ROLE_NAMES>).map((value) => ({ value, label: STAFF_ROLE_NAMES[value] }));

const DAY_TONE = { PRESENT: "positive", LATE: "warning", ABSENT: "negative", ON_LEAVE: "info" } as const;

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
  const [rows, overview, roles] = await Promise.all([listStaff(ctx, filters), staffOverview(ctx), listRoleProfiles(ctx)]);
  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));
  const [leftOn, photos] = await Promise.all([leavingDates(ctx, "STAFF", rows), photoUrlsFor(ctx, "STAFF", rows.map((row) => row.id))]);
  const { counts } = overview;

  return (
    <>
      <PageHeader icon={IdCardIcon} tone="purple"
        title="Non-teaching staff"
        description="Choose a role to see its staff and what they can do, or open a person for their profile, permissions, work and substitutes. Teachers are under Teachers."
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
      {/* Role → staff → profile: the roles first, each a card. */}
      <section aria-labelledby="roles" className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="roles" className="text-base font-semibold">
            Roles
          </h2>
          <a href="#new-role" className="text-primary text-sm font-medium hover:underline">
            + Custom role
          </a>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {roles.map((role, index) => {
            const tone = ROLE_TONES[index % ROLE_TONES.length]!;
            return (
              <li key={role.id}>
                <Link
                  href={`/school-admin/staff/roles/${role.id}` as Route}
                  className={`hover:border-primary/50 flex h-full flex-col gap-1 rounded-2xl border p-4 transition-colors ${role.staffCount ? "bg-card" : "bg-muted/30"}`}
                >
                  <span className={`flex size-9 items-center justify-center rounded-xl ${tone}`}>
                    <UsersIcon className="size-4" aria-hidden />
                  </span>
                  <span className="mt-1 font-semibold">{role.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {role.staffCount} {role.staffCount === 1 ? "staff" : "staff"}
                    {role.isCustom ? " · custom" : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Today at a glance: counts only, no personal details. */}
      <section aria-label="Staff today" className="mb-6 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Current staff", value: counts.total, hint: `${counts.notMarked} not marked today` },
            { label: "Present today", value: counts.present + counts.late, hint: counts.late ? `${counts.late} late` : "On time" },
            { label: "Absent today", value: counts.absent, hint: "Marked absent" },
            { label: "On leave today", value: counts.onLeave, hint: "Marked or approved" },
          ].map((card) => (
            <Card key={card.label} size="sm">
              <CardContent>
                <p className="text-muted-foreground text-xs">{card.label}</p>
                <p className="text-2xl font-semibold tabular-nums">{card.value}</p>
                <p className="text-muted-foreground text-xs">{card.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Link href="/school-admin/attendance/staff" className="text-primary text-sm font-medium hover:underline">
          Mark today&apos;s staff attendance →
        </Link>
      </section>

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
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Designation</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Joined</th>
                    <th className="px-3 py-2 font-medium">Today</th>
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
                        {row.roleProfile?.name ?? humanize(row.role)}
                        {row.designation ? <span className="text-muted-foreground block text-xs">{row.designation}</span> : null}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{row.phone ?? "—"}</td>
                      <td className="px-3 py-2">{row.joiningDate ? formatDate(row.joiningDate) : "—"}</td>
                      <td className="px-3 py-2">
                        {overview.today.get(row.id) ? (
                          <StatusBadge status={overview.today.get(row.id)!} tone={DAY_TONE[overview.today.get(row.id)!]} />
                        ) : (
                          <span className="text-muted-foreground text-xs">{["ACTIVE", "ON_LEAVE"].includes(row.status) ? "Not marked" : "—"}</span>
                        )}
                      </td>
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
              <StaffForm roles={roleOptions} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle id="new-role" className="scroll-mt-24">Custom role</CardTitle>
              <CardDescription>A role the built-in list does not have, such as Hostel warden. Choose what it works like and what new staff in it can do.</CardDescription>
            </CardHeader>
            <CardContent>
              <RoleProfileForm baseRoles={BASE_ROLE_OPTIONS} />
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
