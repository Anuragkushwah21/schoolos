import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { EventDetails } from "@/features/events/events-screen";
import { requireTenant } from "@/server/auth/current-user";
import { viewEvent } from "@/server/communication/events";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage(props: PageProps<"/teacher/events/[eventId]">) {
  const ctx = await requireTenant("TEACHER");
  const { eventId } = await props.params;
  const event = await orNotFound(viewEvent(ctx, eventId));
  return (
    <>
      <PageHeader back={{ href: "/teacher/events", label: "Events" }} title={event.title} />
      <div className="max-w-2xl">
        <EventDetails event={event} />
      </div>
    </>
  );
}
