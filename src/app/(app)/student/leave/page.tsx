import type { Metadata } from "next";
import { CalendarOffIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyLeaveForm } from "@/features/student-leave/forms";
import { LeaveList } from "@/features/student-leave/views";
import { toDateInput, today } from "@/lib/dates";
import { leaveTargets, listStudentLeaves } from "@/server/attendance/student-leave";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "My Leave" };

/** "My Leave": a student's own requests. Optional — a parent can always ask instead. */
export default async function StudentLeavePage() {
  const ctx = await requireTenant("STUDENT");
  const [targets, rows] = await Promise.all([leaveTargets(ctx), listStudentLeaves(ctx)]);
  return (
    <>
      <PageHeader icon={CalendarOffIcon} tone="blue" title="My Leave" description="Your leave requests. Your parent can also apply for you." />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <LeaveList rows={rows} showStudent={false} />
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Apply for Leave</CardTitle>
            <CardDescription>Your class teacher approves it.</CardDescription>
          </CardHeader>
          <CardContent>
            {targets.length ? <ApplyLeaveForm targets={targets} today={toDateInput(today())} /> : <p className="text-muted-foreground text-sm">You are not placed in a class this year.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
