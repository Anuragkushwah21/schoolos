import type { Metadata } from "next";
import { CalendarOffIcon, CheckCircle2Icon, HourglassIcon, XCircleIcon } from "lucide-react";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LeaveSettingsForm } from "@/features/student-leave/forms";
import { LeaveList } from "@/features/student-leave/views";
import { enumParam, param } from "@/lib/search-params";
import { STUDENT_LEAVE_STATUSES } from "@/lib/validation/student-leave";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { listStudentLeaves, studentLeaveSettings } from "@/server/attendance/student-leave";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Student leave" };

/** "All Student Leave Requests": every request in the school, with the power to decide or overturn. */
export default async function AdminStudentLeavePage(props: PageProps<"/school-admin/student-leave">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const status = enumParam(search.status, STUDENT_LEAVE_STATUSES);
  const filters = { status, q: param(search.q), sectionId: param(search.section) };
  const session = await getCurrentSession(ctx);
  const [rows, all, sections, settings] = await Promise.all([
    listStudentLeaves(ctx, filters),
    listStudentLeaves(ctx),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
    studentLeaveSettings(ctx),
  ]);
  const count = (value: string) => all.filter((row) => row.status === value).length;

  return (
    <>
      <PageHeader icon={CalendarOffIcon} tone="blue" title="Leave Management" description="Student leave requests. Class teachers approve their students' leave; you can see, decide or change any of them. Staff leave is in the next tab." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="amber" icon={HourglassIcon} label="Pending" value={count("PENDING")} />
        <StatCard tone="green" icon={CheckCircle2Icon} label="Approved" value={count("APPROVED")} />
        <StatCard tone="red" icon={XCircleIcon} label="Rejected" value={count("REJECTED")} />
        <StatCard tone="neutral" icon={CalendarOffIcon} label="Cancelled" value={count("CANCELLED")} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <ViewTabs
            label="Leave requests by status"
            tabs={[
              { href: "/school-admin/student-leave", label: "All requests", count: all.length, active: !status },
              { href: "/school-admin/student-leave?status=PENDING", label: "Pending", count: count("PENDING"), active: status === "PENDING" },
              { href: "/school-admin/student-leave?status=APPROVED", label: "Approved", count: count("APPROVED"), active: status === "APPROVED" },
              { href: "/school-admin/student-leave?status=REJECTED", label: "Rejected", count: count("REJECTED"), active: status === "REJECTED" },
            ]}
          />
          <FilterBar
            action="/school-admin/student-leave"
            search={{ defaultValue: filters.q, placeholder: "Student name or admission no." }}
            hidden={{ status }}
            selects={[
              { name: "section", label: "Class", defaultValue: filters.sectionId, allLabel: "All classes", options: sections },
            ]}
          />
          <LeaveList rows={rows} />
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Leave rules</CardTitle>
            <CardDescription>How far back a parent or student may date a request.</CardDescription>
          </CardHeader>
          <CardContent>
            <LeaveSettingsForm backdateDays={settings.backdateDays} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
