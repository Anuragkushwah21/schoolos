import { HandshakeIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { PageHeader } from "@/components/shared/page-header";
import { MyMeetings } from "@/features/communication/meeting-views";
import { requireTenant } from "@/server/auth/current-user";
import { myMeetings } from "@/server/communication/meetings";

export const metadata: Metadata = { title: "Meetings" };

/** Meetings the school has invited this user to. Read-only; nothing to book. */
export default async function MeetingsPage() {
  const ctx = await requireTenant("TEACHER");
  const { upcoming, past } = await myMeetings(ctx);
  // A PTM: open the class list (parents' answers, then who came).
  const extras = Object.fromEntries(
    [...upcoming, ...past]
      .filter((meeting) => meeting.type === "PTM" && meeting.status !== "CANCELLED")
      .map((meeting) => [
        meeting.id,
        <Button key={meeting.id} asChild variant="outline" className="w-fit">
          <Link href={`/teacher/meetings/${meeting.id}`}>Class list and attendance</Link>
        </Button>,
      ]),
  );
  return (
    <>
      <PageHeader icon={HandshakeIcon} tone="cyan" title="Meetings" description="Meetings the school has invited you to. Times are set by the school office." />
      <MyMeetings upcoming={upcoming} past={past} extras={extras} emptyHint="When the school calls a staff meeting or a PTM for your classes, it appears here." />
    </>
  );
}
