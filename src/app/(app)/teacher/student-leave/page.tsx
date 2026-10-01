import type { Metadata } from "next";
import { CalendarOffIcon } from "lucide-react";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { ViewTabs } from "@/components/shared/view-tabs";
import { LeaveList } from "@/features/student-leave/views";
import { enumParam, param } from "@/lib/search-params";
import { STUDENT_LEAVE_STATUSES } from "@/lib/validation/student-leave";
import { listStudentLeaves, studentLeaveSummary } from "@/server/attendance/student-leave";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Student leave" };

/** Leave requests for the students of the class(es) this teacher is class teacher of — theirs to approve. */
export default async function TeacherStudentLeavePage(props: PageProps<"/teacher/student-leave">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;
  const status = enumParam(search.status, STUDENT_LEAVE_STATUSES) ?? (param(search.status) === "ALL" ? undefined : "PENDING");
  const [rows, summary] = await Promise.all([listStudentLeaves(ctx, { status, q: param(search.q) }), studentLeaveSummary(ctx)]);
  const tab = (value: string, label: string, count?: number) => ({ href: `/teacher/student-leave?status=${value}`, label, count, active: (status ?? "ALL") === value });
  return (
    <>
      <PageHeader icon={CalendarOffIcon} tone="blue" title="Leave Requests" description="Leave requests for the students of your class — yours to approve. Approved leave shows on your register and as a marker on the calendar. Your own leave is in the next tab." />
      <ViewTabs
        label="Leave requests by status"
        tabs={[tab("PENDING", "Pending", summary.pending), tab("APPROVED", "Approved", summary.approved), tab("REJECTED", "Rejected", summary.rejected), tab("ALL", "All")]}
      />
      <FilterBar
        action="/teacher/student-leave"
        search={{ defaultValue: param(search.q), placeholder: "Student name or admission no." }}
        hidden={{ status: status ?? "ALL" }}
      />
      <LeaveList rows={rows} />
    </>
  );
}
