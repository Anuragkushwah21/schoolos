import { HandshakeIcon } from "lucide-react";
import type { Metadata } from "next";

import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { MyMeetings } from "@/features/communication/meeting-views";
import { requireTenant } from "@/server/auth/current-user";
import { myMeetings } from "@/server/communication/meetings";
import { staffHolds } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Meetings" };

/** Meetings the school has invited this staff member to — and, with "Schedule meetings", the way to arrange them. */
export default async function StaffMeetingsPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const [{ upcoming, past }, canSchedule] = await Promise.all([myMeetings(ctx), staffHolds(ctx, "meetings.schedule")]);
  return (
    <>
      <PageHeader icon={HandshakeIcon} tone="cyan" title="Meetings" description="Meetings the school has invited you to. Times are set by the school office."
        actions={
          canSchedule ? (
            <Button asChild>
              <Link href="/staff/meetings/manage">Schedule & manage meetings</Link>
            </Button>
          ) : undefined
        }
      />
      <MyMeetings upcoming={upcoming} past={past} emptyHint="When the school calls a staff meeting or invites you to one, it appears here." />
    </>
  );
}
