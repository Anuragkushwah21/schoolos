import type { Metadata } from "next";
import { CalendarOffIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyLeaveForm } from "@/features/student-leave/forms";
import { LeaveList } from "@/features/student-leave/views";
import { toDateInput, today } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { leaveTargets, listStudentLeaves } from "@/server/attendance/student-leave";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Leave" };

/** Apply for leave for a child, and "My Leave Requests" — each child's kept apart. */
export default async function ParentLeavePage(props: PageProps<"/parent/leave">) {
  const ctx = await requireTenant("PARENT");
  const search = await props.searchParams;
  const [targets, rows] = await Promise.all([leaveTargets(ctx), listStudentLeaves(ctx)]);

  return (
    <>
      <PageHeader icon={CalendarOffIcon} tone="blue" title="Leave" description="Tell the school when your child will be away. The class teacher approves it." />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="my-leave" className="order-2 flex flex-col gap-4 xl:order-1">
          <h2 id="my-leave" className="text-base font-semibold">
            My Leave Requests
          </h2>
          {targets.length > 1 ? (
            targets.map((child) => (
              <div key={child.id} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  {child.name} <span className="text-muted-foreground font-normal">· {child.group}</span>
                </h3>
                <LeaveList rows={rows.filter((row) => row.studentId === child.id)} showStudent={false} />
              </div>
            ))
          ) : (
            <LeaveList rows={rows} showStudent={false} />
          )}
        </section>
        <Card className="order-1 h-fit xl:order-2">
          <CardHeader>
            <CardTitle>Apply for Leave</CardTitle>
            <CardDescription>For any class, Nursery to 12.</CardDescription>
          </CardHeader>
          <CardContent>
            {targets.length ? (
              <ApplyLeaveForm targets={targets} defaultStudentId={param(search.child)} today={toDateInput(today())} />
            ) : (
              <p className="text-muted-foreground text-sm">None of your children is placed in a class this year.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
