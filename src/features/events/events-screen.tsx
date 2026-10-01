import type { Route } from "next";
import Link from "next/link";
import { CalendarDaysIcon, ClockIcon, MapPinIcon, PartyPopperIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { DateTile, LifecycleBadge } from "@/components/shared/lifecycle-badge";
import { RichText } from "@/components/shared/rich-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { setEventPublishedAction } from "@/features/communication/actions";
import { formatDate, formatMinutes } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TenantContext } from "@/server/auth/current-user";
import { type EventRow, listEvents } from "@/server/communication/events";

/**
 * Events — something happening at school — for every role: Upcoming (today
 * included) and Completed, each worked out from the date. The School Admin
 * also sees drafts, with Edit and Publish/Unpublish on each.
 */

export function eventTime(event: { date: Date; startMinute: number | null; endMinute: number | null }): string {
  if (event.startMinute === null) return "All day";
  return event.endMinute !== null ? `${formatMinutes(event.startMinute)} – ${formatMinutes(event.endMinute)}` : `From ${formatMinutes(event.startMinute)}`;
}

function EventCard({ event, basePath, admin }: { event: EventRow; basePath: string; admin: boolean }) {
  const href = `${basePath}/${event.id}` as Route;
  const done = event.status === "COMPLETED";
  return (
    <Card className={cn("py-0", done && "opacity-85")}>
      <CardContent className="flex gap-4 p-4 sm:p-5">
        <DateTile date={event.date} tone={done ? "neutral" : "blue"} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={href} className="text-base font-semibold hover:underline">
              {event.title}
            </Link>
            <span className="flex flex-wrap items-center gap-1.5">
              <LifecycleBadge status={event.status} countdown={event.countdown} />
              {admin && !event.isPublished ? <StatusBadge status="DRAFT" label="Draft — not published" /> : null}
            </span>
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1">
              <CalendarDaysIcon className="size-3.5" aria-hidden />
              {formatDate(event.date)}
            </span>
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3.5" aria-hidden />
              {eventTime(event)}
            </span>
            {event.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="size-3.5" aria-hidden />
                {event.location}
              </span>
            ) : null}
          </p>
          {event.description ? <p className="text-muted-foreground line-clamp-2 text-sm">{event.description}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={href}>View event</Link>
            </Button>
            {admin ? (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`${href}#edit` as Route}>Edit</Link>
                </Button>
                <ActionButton action={setEventPublishedAction} fields={{ eventId: event.id, publish: event.isPublished ? "false" : "true" }} variant="ghost">
                  {event.isPublished ? "Unpublish" : "Publish"}
                </ActionButton>
              </>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export async function EventsScreen({ ctx, basePath, view }: { ctx: TenantContext; basePath: string; view?: string }) {
  const admin = ctx.user.role === "SCHOOL_ADMIN";
  const { upcoming, completed, completedCount } = await listEvents(ctx);
  const showCompleted = view === "completed";
  const rows = showCompleted ? completed : upcoming;

  return (
    <>
      <ViewTabs
        label="Events"
        tabs={[
          { href: basePath, label: "Upcoming", count: upcoming.length, active: !showCompleted },
          { href: `${basePath}?view=completed`, label: "Completed", count: completedCount, active: showCompleted },
        ]}
      />
      {rows.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((event) => (
            <EventCard key={event.id} event={event} basePath={basePath} admin={admin} />
          ))}
        </div>
      ) : (
        <EmptyState icon={PartyPopperIcon} tone="blue" title={showCompleted ? "No completed events yet" : "No upcoming events"}>
          {showCompleted
            ? "Events move here by themselves once their day has passed."
            : admin
              ? "Add sports day, the annual function or a trip — publish it and everyone sees it."
              : "When the school plans an event, it appears here."}
        </EmptyState>
      )}
    </>
  );
}

/** One event's details, for every role's event page. */
export function EventDetails({ event }: { event: EventRow }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Date", formatDate(event.date)],
    ["Time", eventTime(event)],
    ["Where", event.location ?? "—"],
    ["Status", <LifecycleBadge key="status" status={event.status} countdown={event.countdown} />],
  ];
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <DateTile date={event.date} tone={event.status === "COMPLETED" ? "neutral" : "blue"} />
          <p className="text-2xl font-extrabold tracking-tight tabular-nums">{event.countdown}</p>
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
        {event.description ? <RichText text={event.description} className="text-sm" /> : null}
      </CardContent>
    </Card>
  );
}
