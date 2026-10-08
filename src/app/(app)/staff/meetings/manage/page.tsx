import type { Metadata } from "next";

import { MeetingsListScreen } from "@/features/communication/screens/meetings-list";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Schedule meetings" };

/** The school's meetings, for staff the School Admin allowed to schedule them. Deleting stays with the admin. */
export default async function StaffManageMeetingsPage(props: PageProps<"/staff/meetings/manage">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "meetings.schedule");
  return <MeetingsListScreen ctx={ctx} search={await props.searchParams} base="/staff/meetings/manage" admin={false} back={{ href: "/staff/meetings", label: "My meetings" }} />;
}
