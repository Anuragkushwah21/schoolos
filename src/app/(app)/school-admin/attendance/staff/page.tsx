import { ClipboardCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StaffRegister } from "@/features/attendance/register";
import { formatDayShort, parseDateInput, today, toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getStaffRegister } from "@/server/attendance/service";
import { describeClosure, schoolClosureOn } from "@/server/calendar/holidays";

export const metadata: Metadata = { title: "Staff attendance" };

export default async function StaffAttendancePage(props: PageProps<"/school-admin/attendance/staff">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const date = parseDateInput(param(search.date)) ?? today();
  const [rows, closure] = await Promise.all([getStaffRegister(ctx, date), schoolClosureOn(ctx, date)]);
  const holiday = closure?.kind === "HOLIDAY";

  return (
    <>
      <PageHeader icon={ClipboardCheckIcon} tone="green"
        back={{ href: "/school-admin/attendance", label: "Attendance" }}
        title="Staff attendance"
        description={formatDayShort(date)}
      />
      <FilterBar
        action="/school-admin/attendance/staff"
        dates={[{ name: "date", label: "Date", defaultValue: toDateInput(date), max: toDateInput(today()) }]}
      />
      {closure ? (
        <p
          className={
            holiday
              ? "mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong"
              : "bg-muted/40 mb-4 rounded-lg border px-3 py-2 text-sm"
          }
        >
          {holiday
            ? `${describeClosure(closure, date)} No attendance is needed.`
            : `${closure.label} — attendance is not required. Record it only for a special working day.`}
        </p>
      ) : null}
      {rows.length ? (
        <StaffRegister
          date={toDateInput(date)}
          editable={!holiday}
          rows={rows.map((row) => ({
            id: row.teacherId,
            name: row.name,
            detail: `${row.employeeId}${row.onApprovedLeave ? " · approved leave" : row.onLeave ? " · on leave" : ""}`,
            // Approved leave pre-fills the register; it is saved with the rest.
            status: row.status ?? (row.onApprovedLeave ? "ON_LEAVE" : null),
            remarks: row.remarks ?? (row.onApprovedLeave && !row.status ? "Approved leave" : null),
          }))}
        />
      ) : (
        <SetupNotice title="Staff attendance" need="teachers" />
      )}
    </>
  );
}
