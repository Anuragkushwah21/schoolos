import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { deleteEventAction } from "@/features/communication/actions";
import { EventForm } from "@/features/communication/forms";
import { minutesToTime, toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getEvent } from "@/server/communication/events";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Edit event" };

export default async function EditEventPage(props: PageProps<"/admin/events/[eventId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { eventId } = await props.params;
  const event = await orNotFound(getEvent(ctx, eventId));

  return (
    <>
      <PageHeader
        back={{ href: "/admin/events", label: "Events" }}
        title={event.title}
        actions={
          <ActionButton
            action={deleteEventAction}
            fields={{ eventId: event.id }}
            variant="destructive"
            confirm={{ title: "Delete this event?", description: "This cannot be undone.", confirmLabel: "Delete" }}
          >
            Delete
          </ActionButton>
        }
      />
      <EventForm
        event={{
          id: event.id,
          title: event.title,
          description: event.description,
          date: toDateInput(event.date),
          startMinute: event.startMinute !== null ? minutesToTime(event.startMinute) : "",
          endMinute: event.endMinute !== null ? minutesToTime(event.endMinute) : "",
          location: event.location,
          imageUrl: event.imageUrl,
          isPublished: event.isPublished,
        }}
      />
    </>
  );
}
