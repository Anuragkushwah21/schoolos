import type { Metadata } from "next";

import { MeetingManageScreen } from "@/features/communication/screens/meeting-manage";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Meeting" };

export default async function AdminMeetingPage(props: PageProps<"/school-admin/meetings/[meetingId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { meetingId } = await props.params;
  return <MeetingManageScreen ctx={ctx} meetingId={meetingId} base="/school-admin/meetings" />;
}
