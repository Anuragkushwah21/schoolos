import type { Metadata } from "next";

import { MeetingManageScreen } from "@/features/communication/screens/meeting-manage";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Meeting" };

export default async function StaffMeetingPage(props: PageProps<"/staff/meetings/manage/[meetingId]">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "meetings.schedule");
  const { meetingId } = await props.params;
  return <MeetingManageScreen ctx={ctx} meetingId={meetingId} base="/staff/meetings/manage" />;
}
