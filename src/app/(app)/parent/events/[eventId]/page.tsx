import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { EventDetails } from "@/features/events/events-screen";
import { requireTenant } from "@/server/auth/current-user";
import { viewEvent } from "@/server/communication/events";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage(props: PageProps<"/parent/events/[eventId]">) {
  const ctx = await requireTenant("PARENT");
  const { eventId } = await props.params;
  const event = await orNotFound(viewEvent(ctx, eventId));
  return (
    <>
      <PageHeader back={{ href: "/parent/events", label: "Events" }} title={event.title} />
      <div className="max-w-2xl">
        <EventDetails event={event} />
      </div>
    </>
  );
}
