import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteEventAction,
  setEventPublishedAction,
} from "@/features/communication/actions";
import { EventForm } from "@/features/communication/forms";
import { EventDetails } from "@/features/events/events-screen";
import { minutesToTime, today, toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { viewEvent } from "@/server/communication/events";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Event" };

export default async function EditEventPage(
  props: PageProps<"/school-admin/events/[eventId]">,
) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { eventId } = await props.params;
  const event = await orNotFound(viewEvent(ctx, eventId));

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/events", label: "Events" }}
        title={event.title}
        actions={
          <>
            <ActionButton
              action={setEventPublishedAction}
              fields={{
                eventId: event.id,
                publish: event.isPublished ? "false" : "true",
              }}
              variant="outline"
              size="default"
            >
              {event.isPublished ? "Unpublish" : "Publish"}
            </ActionButton>
            <ActionButton
              action={deleteEventAction}
              fields={{ eventId: event.id }}
              variant="destructive"
              confirm={{
                title: "Delete this event?",
                description: "This cannot be undone.",
                confirmLabel: "Delete",
              }}
            >
              Delete
            </ActionButton>
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            {event.isPublished
              ? "Published — everyone in the school can see it."
              : "Draft — only you can see it until you publish it."}
          </p>
          <EventDetails event={event} />
        </div>
        <Card id="edit" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Edit event</CardTitle>
          </CardHeader>
          <CardContent>
            <EventForm
              minDate={toDateInput(event.date < today() ? event.date : today())}
              event={{
                id: event.id,
                title: event.title,
                description: event.description,
                date: toDateInput(event.date),
                startMinute:
                  event.startMinute !== null
                    ? minutesToTime(event.startMinute)
                    : "",
                endMinute:
                  event.endMinute !== null
                    ? minutesToTime(event.endMinute)
                    : "",
                location: event.location,
                imageUrl: event.imageUrl,
                isPublished: event.isPublished,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
