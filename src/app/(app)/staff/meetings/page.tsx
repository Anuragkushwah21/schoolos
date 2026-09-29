import { HandshakeIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MyMeetings } from "@/features/communication/meeting-views";
import { requireTenant } from "@/server/auth/current-user";
import { myMeetings } from "@/server/communication/meetings";

export const metadata: Metadata = { title: "Meetings" };

/** Meetings the school has invited this staff member to. Read-only. */
export default async function StaffMeetingsPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const { upcoming, past } = await myMeetings(ctx);
  return (
    <>
      <PageHeader icon={HandshakeIcon} tone="cyan" title="Meetings" description="Meetings the school has invited you to. Times are set by the school office." />
      <MyMeetings upcoming={upcoming} past={past} emptyHint="When the school calls a staff meeting or invites you to one, it appears here." />
    </>
  );
}
