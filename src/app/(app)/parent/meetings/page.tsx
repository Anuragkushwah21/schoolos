import { HandshakeIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MyMeetings } from "@/features/communication/meeting-views";
import { requireTenant } from "@/server/auth/current-user";
import { myMeetings } from "@/server/communication/meetings";
import { myPtmResponses } from "@/server/communication/ptm";
import { PtmResponseButtons } from "@/features/communication/ptm-forms";

export const metadata: Metadata = { title: "Meetings" };

/** Meetings the school has invited this user to. Read-only; nothing to book. */
export default async function MeetingsPage() {
  const ctx = await requireTenant("PARENT");
  const [{ upcoming, past }, responses] = await Promise.all([myMeetings(ctx), myPtmResponses(ctx)]);
  const extras = Object.fromEntries(Object.entries(responses).map(([meetingId, children]) => [meetingId, <PtmResponseButtons key={meetingId} meetingId={meetingId} kids={children} />]));
  return (
    <>
      <PageHeader icon={HandshakeIcon} tone="cyan" title="Meetings" description="Meetings the school has invited you to. Times are set by the school office." />
      <MyMeetings upcoming={upcoming} past={past} extras={extras} emptyHint="When the school calls a parent-teacher meeting or any meeting for your child's class, it appears here." />
    </>
  );
}
