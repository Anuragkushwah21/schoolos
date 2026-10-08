import type { Route } from "next";
import Link from "next/link";
import { CalendarOffIcon, ChevronRightIcon, HandshakeIcon, type LucideIcon, MegaphoneIcon, PartyPopperIcon } from "lucide-react";

import { type AccentTone, TONE_SOLID } from "@/components/shared/tones";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { studentLeaveSummary } from "@/server/attendance/student-leave";
import type { TenantContext } from "@/server/auth/current-user";
import { eventSummary } from "@/server/communication/events";
import { meetingSummary } from "@/server/communication/meetings";
import { unreadNoticeSummary } from "@/server/communication/notices";
import { myLeaveSummary, pendingStaffLeaveCount } from "@/server/staff/leave";

/**
 * "School updates" on every dashboard: Events, Leave, Notices and Meetings as
 * four rows of one card — each with how many need a look and the one item
 * most worth opening, never a long list. A row with nothing in it says so in
 * a word and stays quiet, so an empty week does not fill the phone screen
 * with zeros. Each concept keeps its own page: Event = something happening,
 * Meeting = people meeting, Notice = a message, Leave = an absence request.
 */

type Highlight = { caption: string; title: string; when: string; badge?: string; href: string };

function UpdateRow({
  label,
  count,
  icon: Icon,
  tone,
  highlight,
  empty,
  href,
}: {
  label: string;
  count: number;
  icon: LucideIcon;
  tone: AccentTone;
  highlight: Highlight | null;
  empty: string;
  href: string;
}) {
  return (
    <li>
      <Link href={(highlight?.href ?? href) as Route} className="hover:bg-muted/50 flex min-h-16 items-center gap-3 px-4 py-3 transition-colors">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", count ? TONE_SOLID[tone] : "bg-muted text-muted-foreground")}>
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {label}
            {count ? <span className="bg-primary text-primary-foreground rounded-full px-2 text-xs leading-5 font-bold tabular-nums">{count}</span> : null}
          </span>
          {highlight ? (
            <span className="text-muted-foreground block truncate text-xs">
              <span className="text-foreground font-medium">{highlight.title}</span> · {highlight.when}
              {highlight.badge ? ` · ${highlight.badge}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground block text-xs">{empty}</span>
          )}
        </span>
        <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      </Link>
    </li>
  );
}

const span = (from: Date, to: Date) => (from.getTime() === to.getTime() ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);

export async function SchoolLifeCards({
  ctx,
  base,
  narrow = false,
}: {
  ctx: TenantContext;
  /** The role's area: "/school-admin", "/teacher", "/parent", "/student", "/staff". */
  base: string;
  /** One card per row, for a side column. */
  narrow?: boolean;
}) {
  const role = ctx.user.role;
  const leader = role === "SCHOOL_ADMIN" || role === "PRINCIPAL";
  const leavePath = leader ? "/school-admin/student-leave" : role === "TEACHER" ? "/teacher/student-leave" : `${base}/leave`;

  const [events, meetings, notices, leave, staffPending] = await Promise.all([
    eventSummary(ctx),
    meetingSummary(ctx),
    unreadNoticeSummary(ctx),
    // The Principal has no leave desk: the row is left out for them.
    role === "NON_TEACHING_STAFF" ? myLeaveSummary(ctx) : studentLeaveSummary(ctx),
    leader ? pendingStaffLeaveCount(ctx) : Promise.resolve(0),
  ]);

  const leaveHighlight: Highlight | null = (() => {
    const item = leave?.highlight;
    if (!item) return null;
    const pending = item.status === "PENDING";
    const who = "student" in item && typeof item.student === "string" ? item.student : "Your leave";
    const from = "fromDate" in item ? item.fromDate : (item as { startDate: Date }).startDate;
    const to = "toDate" in item ? item.toDate : (item as { endDate: Date }).endDate;
    return { caption: pending ? "Waiting for a decision" : "Next approved leave", title: who, when: span(from, to), badge: pending ? "Pending" : "Approved", href: leavePath };
  })();

  const meetingHref = (id: string) => (leader ? `/school-admin/meetings/${id}` : `${base}/meetings`);
  const leaveLabel = leader || role === "TEACHER" ? "Leave requests" : role === "PARENT" ? "Leave" : "My leave";

  return (
    <section aria-labelledby="school-updates" className="bg-card shadow-card mb-8 overflow-hidden rounded-2xl border border-border/70">
      <h2 id="school-updates" className="border-b px-4 py-3 text-base font-semibold">
        School updates
      </h2>
      <ul className={cn("divide-y", !narrow && "sm:grid sm:grid-cols-2 sm:divide-y-0 sm:[&>li]:border-b sm:[&>li:nth-child(odd)]:border-r")}>
        <UpdateRow
          label="Notices"
          count={notices.unread}
          icon={MegaphoneIcon}
          tone="amber"
          href={`${base}/notices`}
          highlight={notices.latest ? { caption: "", title: notices.latest.title, when: formatDate(notices.latest.publishAt ?? notices.latest.createdAt), href: `${base}/notices` } : null}
          empty="No new notices."
        />
        <UpdateRow
          label="Events"
          count={events.upcoming}
          icon={PartyPopperIcon}
          tone="blue"
          href={`${base}/events`}
          highlight={events.next ? { caption: "", title: events.next.title, when: formatDate(events.next.date), badge: events.next.countdown, href: `${base}/events/${events.next.id}` } : null}
          empty="No events coming up."
        />
        <UpdateRow
          label="Meetings"
          count={meetings.upcoming}
          icon={HandshakeIcon}
          tone="cyan"
          href={`${base}/meetings`}
          highlight={meetings.next ? { caption: "", title: meetings.next.title, when: `${formatDate(meetings.next.date)} · ${meetings.next.time}`, badge: meetings.next.countdown, href: meetingHref(meetings.next.id) } : null}
          empty="No meetings scheduled."
        />
        {leave ? (
        <UpdateRow
          label={leaveLabel}
          count={leave.pending + staffPending}
          icon={CalendarOffIcon}
          tone="green"
          href={leavePath}
          highlight={leaveHighlight}
          empty={leader || role === "TEACHER" ? "No leave requests waiting." : "No leave requests."}
        />
        ) : null}
      </ul>
    </section>
  );
}
