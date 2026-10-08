import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MeetingForm } from "@/features/communication/meeting-forms";
import { today, toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";
import { meetingTargetOptions } from "@/server/communication/meetings";

export const metadata: Metadata = { title: "Schedule meeting" };

export default async function StaffNewMeetingPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "meetings.schedule");
  const options = await meetingTargetOptions(ctx);
  return (
    <>
      <PageHeader
        back={{ href: "/staff/meetings/manage", label: "Meetings" }}
        title="Schedule meeting"
        description="Set the time and choose who is invited. Everyone invited sees it in their portal as soon as it is saved."
      />
      <MeetingForm today={toDateInput(today())} {...options} />
    </>
  );
}
