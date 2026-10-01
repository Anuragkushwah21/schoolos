import type { Route } from "next";
import Link from "next/link";
import { CalendarOffIcon, HandshakeIcon, type LucideIcon, MegaphoneIcon, PartyPopperIcon } from "lucide-react";

import { type AccentTone, TONE_GLOW, TONE_SOLID } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { studentLeaveSummary } from "@/server/attendance/student-leave";
import type { TenantContext } from "@/server/auth/current-user";
import { eventSummary } from "@/server/communication/events";
import { meetingSummary } from "@/server/communication/meetings";
import { unreadNoticeSummary } from "@/server/communication/notices";
import { myLeaveSummary, pendingStaffLeaveCount } from "@/server/staff/leave";

/**
 * The four "school life" cards on every dashboard — Events, Leave, Notices,
 * Meetings — each a count and the one item most worth a look, never a long
 * list. Each concept keeps its own card and its own page:
 * Event = something happening, Meeting = people meeting, Notice = a message,
 * Leave = an absence request.
 */

type Highlight = { caption: string; title: string; when: string; badge?: string; href: string };

function SummaryCard({
  label,
  count,
  icon: Icon,
  tone,
  highlight,
  empty,
  footer,
  href,
}: {
  label: string;
  count: number;
  icon: LucideIcon;
  tone: AccentTone;
  highlight: Highlight | null;
  empty: string;
  footer?: string;
  href: string;
}) {
  return (
    <div className="bg-card shadow-card relative isolate flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 p-4 sm:p-5">
      <span className={cn("absolute -top-10 -right-10 -z-10 size-32 rounded-full blur-2xl", TONE_GLOW[tone])} aria-hidden />
      <div className="flex items-center justify-between gap-3">
        <Link href={href as Route} className="text-muted-foreground text-sm font-medium hover:underline">
          {label}
        </Link>
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONE_SOLID[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      <p className="text-3xl font-extrabold tracking-tight tabular-nums">{count}</p>
      <div className="bg-muted/50 flex flex-1 flex-col gap-1 rounded-xl p-3">
        {highlight ? (
          <>
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{highlight.caption}</span>
            <span className="line-clamp-2 text-sm font-semibold">{highlight.title}</span>
            <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {highlight.when}
              {highlight.badge ? (
                <span className="bg-primary-soft text-primary-strong rounded-full px-2 py-0.5 font-semibold whitespace-nowrap">{highlight.badge}</span>
              ) : null}
            </span>
            <Button asChild variant="outline" size="sm" className="mt-2 w-fit">
              <Link href={highlight.href as Route}>View</Link>
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">{empty}</span>
        )}
      </div>
      {footer ? <p className="text-muted-foreground text-xs">{footer}</p> : null}
    </div>
  );
}

const span = (from: Date, to: Date) => (from.getTime() === to.getTime() ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);

export async function SchoolLifeCards({
  ctx,
  base,
}: {
  ctx: TenantContext;
  /** The role's area: "/school-admin", "/teacher", "/parent", "/student", "/staff". */
  base: string;
}) {
  const role = ctx.user.role;
  const leavePath = role === "SCHOOL_ADMIN" ? "/school-admin/student-leave" : role === "TEACHER" ? "/teacher/student-leave" : `${base}/leave`;

  const [events, meetings, notices, leave, staffPending] = await Promise.all([
    eventSummary(ctx),
    meetingSummary(ctx),
    unreadNoticeSummary(ctx),
    role === "NON_TEACHING_STAFF" ? myLeaveSummary(ctx) : studentLeaveSummary(ctx),
    role === "SCHOOL_ADMIN" ? pendingStaffLeaveCount(ctx) : Promise.resolve(0),
  ]);

  const leaveHighlight: Highlight | null = (() => {
    const item = leave.highlight;
    if (!item) return null;
    const pending = item.status === "PENDING";
    const who = "student" in item && typeof item.student === "string" ? item.student : "Your leave";
    const from = "fromDate" in item ? item.fromDate : (item as { startDate: Date }).startDate;
    const to = "toDate" in item ? item.toDate : (item as { endDate: Date }).endDate;
    return { caption: pending ? "Waiting for a decision" : "Next approved leave", title: who, when: span(from, to), badge: pending ? "Pending" : "Approved", href: leavePath };
  })();

  const meetingHref = (id: string) => (role === "SCHOOL_ADMIN" ? `/school-admin/meetings/${id}` : `${base}/meetings`);
  const leaveLabel = role === "SCHOOL_ADMIN" || role === "TEACHER" ? "Pending leave" : "My pending leave";

  return (
    <section aria-label="Events, leave, notices and meetings" className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label="Upcoming events"
        count={events.upcoming}
        icon={PartyPopperIcon}
        tone="blue"
        href={`${base}/events`}
        highlight={events.next ? { caption: "Next event", title: events.next.title, when: formatDate(events.next.date), badge: events.next.countdown, href: `${base}/events/${events.next.id}` } : null}
        empty="No events coming up."
        footer={`${events.completed} completed`}
      />
      <SummaryCard
        label={leaveLabel}
        count={leave.pending + staffPending}
        icon={CalendarOffIcon}
        tone="green"
        href={leavePath}
        highlight={leaveHighlight}
        empty={role === "SCHOOL_ADMIN" || role === "TEACHER" ? "No leave requests waiting." : "No leave requests."}
        footer={`${leave.approved} approved · ${leave.rejected} rejected${staffPending ? ` · ${staffPending} staff leave pending` : ""}`}
      />
      <SummaryCard
        label="Unread notices"
        count={notices.unread}
        icon={MegaphoneIcon}
        tone="amber"
        href={`${base}/notices`}
        highlight={
          notices.latest
            ? { caption: notices.unread ? "Latest unread" : "Latest notice", title: notices.latest.title, when: `Published ${formatDate(notices.latest.publishAt ?? notices.latest.createdAt)}`, href: `${base}/notices` }
            : null
        }
        empty="No notices right now."
        footer={`${notices.total} current notices`}
      />
      <SummaryCard
        label="Upcoming meetings"
        count={meetings.upcoming}
        icon={HandshakeIcon}
        tone="cyan"
        href={`${base}/meetings`}
        highlight={meetings.next ? { caption: "Next meeting", title: meetings.next.title, when: `${formatDate(meetings.next.date)} · ${meetings.next.time}`, badge: meetings.next.countdown, href: meetingHref(meetings.next.id) } : null}
        empty="No meetings scheduled."
        footer={`${meetings.completed} completed`}
      />
    </section>
  );
}
