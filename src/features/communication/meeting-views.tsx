import { ExternalLinkIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { RichText } from "@/components/shared/rich-text";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { MeetingView } from "@/server/communication/meetings";

const TYPE_LABEL = { PTM: "Parent-teacher meeting", GENERAL: "Meeting" } as const;

/** Everything about one meeting, as a definition list. */
export function MeetingDetails({ meeting, showCreator = false }: { meeting: MeetingView; showCreator?: boolean }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Kind", TYPE_LABEL[meeting.type]],
    ["Date", formatDate(meeting.date)],
    ["Time", meeting.endMinute === null ? `${meeting.time} (no set end)` : meeting.time],
    ["Location", meeting.location ?? "—"],
  ];
  if (meeting.meetingLink) {
    rows.push([
      "Online link",
      meeting.timeStatus === "COMPLETED" || meeting.timeStatus === "CANCELLED" ? (
        <span className="text-muted-foreground break-all">{meeting.meetingLink}</span>
      ) : (
        <a href={meeting.meetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all underline">
          Join online <ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      ),
    ]);
  }
  rows.push(["Invited", meeting.audience]);
  if (showCreator) rows.push(["Created by", `${meeting.createdBy ?? "—"} · ${formatDateTime(meeting.createdAt)}`]);
  if (meeting.status === "CANCELLED") {
    rows.push(["Cancelled", `${meeting.cancelledAt ? formatDateTime(meeting.cancelledAt) : ""}${meeting.cancelReason ? ` — ${meeting.cancelReason}` : ""}`]);
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {meeting.description ? <RichText text={meeting.description} className="text-sm" /> : null}
    </div>
  );
}

function MeetingCard({ meeting }: { meeting: MeetingView }) {
  const muted = meeting.timeStatus === "COMPLETED" || meeting.timeStatus === "CANCELLED";
  return (
    <Card className={muted ? "opacity-80" : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className={meeting.timeStatus === "CANCELLED" ? "line-through" : undefined}>{meeting.title}</span>
          <TimeStatusBadge status={meeting.timeStatus} label={meeting.timeStatus === "ONGOING" ? "Happening now" : undefined} />
        </CardTitle>
        <CardDescription>
          {formatDate(meeting.date)} · {meeting.time}
          {meeting.location ? ` · ${meeting.location}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MeetingDetails meeting={meeting} />
      </CardContent>
    </Card>
  );
}

/** An invitee's meetings: what is coming up (or happening now), then history. */
export function MyMeetings({ upcoming, past, emptyHint }: { upcoming: MeetingView[]; past: MeetingView[]; emptyHint: string }) {
  if (!upcoming.length && !past.length) {
    return <EmptyState title="No meetings yet">{emptyHint}</EmptyState>;
  }
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Upcoming</h2>
        {upcoming.length ? (
          upcoming.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} />)
        ) : (
          <p className="text-muted-foreground text-sm">Nothing scheduled right now.</p>
        )}
      </section>
      {past.length ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Past meetings</h2>
          {past.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
