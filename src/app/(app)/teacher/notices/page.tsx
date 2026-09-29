import { MegaphoneIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { EventList, NoticeList } from "@/features/communication/feed";
import { requireTenant } from "@/server/auth/current-user";
import { upcomingEvents } from "@/server/communication/events";
import { noticesFor } from "@/server/communication/notices";

export const metadata: Metadata = { title: "Notices" };

export default async function NoticesPage() {
  const ctx = await requireTenant("TEACHER");
  const [notices, events] = await Promise.all([noticesFor(ctx), upcomingEvents(ctx, 10)]);

  return (
    <>
      <PageHeader icon={MegaphoneIcon} tone="amber" title="Notices" description="Announcements from your school." />
      <div className="grid gap-8 xl:grid-cols-[1.5fr_1fr]">
        <NoticeList notices={notices} />
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Upcoming events</h2>
          <EventList events={events} />
        </section>
      </div>
    </>
  );
}
