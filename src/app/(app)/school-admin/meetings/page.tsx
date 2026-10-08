import type { Metadata } from "next";

import { MeetingsListScreen } from "@/features/communication/screens/meetings-list";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Meetings" };

export default async function AdminMeetingsPage(props: PageProps<"/school-admin/meetings">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  return <MeetingsListScreen ctx={ctx} search={await props.searchParams} base="/school-admin/meetings" admin />;
}
