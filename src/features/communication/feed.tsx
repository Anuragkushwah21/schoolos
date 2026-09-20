import { CalendarDaysIcon, MapPinIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { RichText } from "@/components/shared/rich-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMinutes } from "@/lib/dates";
import { humanize } from "@/lib/format";

type NoticeCard = {
  id: string;
  title: string;
  body: string;
  audience: string;
  publishAt: Date | null;
  createdAt: Date;
};

export function NoticeList({
  notices,
  showAudience = false,
  compact = false,
}: {
  notices: NoticeCard[];
  showAudience?: boolean;
  compact?: boolean;
}) {
  if (!notices.length) return <EmptyState title="No notices right now" />;

  return (
    <ul className="flex flex-col gap-3">
      {notices.map((notice) => (
        <li key={notice.id} className="bg-card rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{notice.title}</h3>
            <div className="flex items-center gap-2">
              {showAudience && notice.audience !== "ALL" ? (
                <StatusBadge status="INFO" tone="info" label={humanize(notice.audience)} />
              ) : null}
              <span className="text-muted-foreground text-xs">{formatDate(notice.publishAt ?? notice.createdAt)}</span>
            </div>
          </div>
          {compact ? (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">{notice.body}</p>
          ) : (
            <RichText text={notice.body} className="mt-2 text-sm" />
          )}
        </li>
      ))}
    </ul>
  );
}

type EventCard = {
  id: string;
  title: string;
  description: string | null;
  date: Date;
  startMinute: number | null;
  endMinute: number | null;
  location: string | null;
};

export function EventList({ events }: { events: EventCard[] }) {
  if (!events.length) return <EmptyState title="No upcoming events" />;

  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-4 rounded-xl border p-4">
          <div className="bg-primary/10 text-primary flex w-14 shrink-0 flex-col items-center justify-center rounded-lg py-2">
            <span className="text-xs font-medium uppercase">
              {new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short" }).format(event.date)}
            </span>
            <span className="text-xl font-semibold tabular-nums">{event.date.getUTCDate()}</span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">{event.title}</h3>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1">
                <CalendarDaysIcon className="size-3.5" aria-hidden />
                {formatDate(event.date)}
                {event.startMinute !== null ? `, ${formatMinutes(event.startMinute)}` : ""}
                {event.endMinute !== null ? ` – ${formatMinutes(event.endMinute)}` : ""}
              </span>
              {event.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPinIcon className="size-3.5" aria-hidden />
                  {event.location}
                </span>
              ) : null}
            </p>
            {event.description ? <RichText text={event.description} className="mt-2 text-sm" /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
