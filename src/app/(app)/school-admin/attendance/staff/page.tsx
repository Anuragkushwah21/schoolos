import type { Metadata } from "next";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StaffRegister } from "@/features/attendance/register";
import { formatDayShort, parseDateInput, today, toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getStaffRegister } from "@/server/attendance/service";

export const metadata: Metadata = { title: "Staff attendance" };

export default async function StaffAttendancePage(props: PageProps<"/school-admin/attendance/staff">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const date = parseDateInput(param(search.date)) ?? today();
  const rows = await getStaffRegister(ctx, date);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/attendance", label: "Attendance" }}
        title="Staff attendance"
        description={formatDayShort(date)}
      />
      <FilterBar
        action="/school-admin/attendance/staff"
        dates={[{ name: "date", label: "Date", defaultValue: toDateInput(date), max: toDateInput(today()) }]}
      />
      {rows.length ? (
        <StaffRegister
          date={toDateInput(date)}
          rows={rows.map((row) => ({
            id: row.teacherId,
            name: row.name,
            detail: `${row.employeeId}${row.onLeave ? " · on leave" : ""}`,
            status: row.status,
            remarks: row.remarks,
          }))}
        />
      ) : (
        <SetupNotice title="Staff attendance" need="teachers" />
      )}
    </>
  );
}
