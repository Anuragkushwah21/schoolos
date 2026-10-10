import type { Route } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { RichText } from "@/components/shared/rich-text";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { closureOn, formatSpan, type SchoolCalendar, spanDays } from "@/lib/calendar";
import { spanStatus } from "@/lib/time-status";
import { addDays, DAY_SHORT, dateOnly, formatDate, formatMinutes, formatMonth, today, toDateInput } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TenantContext } from "@/server/auth/current-user";
import { type CalendarEntry, type CalendarKind, getCalendarEntries, upcomingEntries } from "@/server/calendar/entries";
import { getWeeklyOffDays, type Holiday, listHolidays } from "@/server/calendar/holidays";

/**
 * The school's holiday calendar, as every role sees it.
 *
 * The School Admin gets edit links; teachers, students and parents get the
 * same screen read-only. Nothing here decides access — the page guard and the
 * service's role checks do — `editable` only chooses which links to draw.
 */

/** "2026-11" → 1 Nov 2026, or the current month for anything unparseable. */
function monthFrom(value: string | undefined, fallback: Date): Date {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return dateOnly(Number(match[1]), month, 1);
  }
  return dateOnly(fallback.getUTCFullYear(), fallback.getUTCMonth() + 1, 1);
}

const monthKey = (date: Date) => toDateInput(date).slice(0, 7);

/** Monday-first order for the grid. */
const GRID_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

const ENTRY_STYLE: Record<CalendarKind, string> = {
  // The same colours as each area's own pages: events blue, exams purple,
  // meetings cyan; holidays amber (also the day itself in the grid).
  HOLIDAY: "bg-warning-soft text-warning-strong",
  EVENT: "bg-primary-soft text-primary-strong",
  MEETING: "bg-info-soft text-info-strong",
  EXAM: "bg-purple-soft text-purple-strong",
  TEST: "bg-orange-soft text-orange-strong",
  // Approved student leave: a marker only — leave is managed on the Leave pages.
  LEAVE: "bg-success-soft text-success-strong",
};
const ENTRY_LABEL: Record<CalendarKind, string> = { HOLIDAY: "Holiday", EVENT: "Event", MEETING: "Meeting", EXAM: "Exam", TEST: "Class test", LEAVE: "Leave" };

function timeText(entry: CalendarEntry): string {
  if (entry.startMinute === null) return "";
  return entry.endMinute !== null ? `${formatMinutes(entry.startMinute)} – ${formatMinutes(entry.endMinute)}` : formatMinutes(entry.startMinute);
}

function whenLabel(entry: CalendarEntry, now: Date): string {
  const days = Math.round((entry.startDate.getTime() - now.getTime()) / 86_400_000);
  if (entry.startDate <= now && now <= entry.endDate) return "Today";
  if (days === 1) return "Tomorrow";
  return formatSpan(entry.startDate, entry.endDate);
}

/** One calendar item with everything a person needs: when, where, how to join, and what to do. */
function EntryDetails({ entry, now }: { entry: CalendarEntry; now: Date }) {
  return (
    <li className="flex flex-col gap-1.5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", ENTRY_STYLE[entry.kind])}>{ENTRY_LABEL[entry.kind]}</span>
        <span className={cn("font-semibold", entry.cancelled && "line-through")}>{entry.title}</span>
        {entry.cancelled ? <TimeStatusBadge status="CANCELLED" label="Cancelled" /> : null}
        {entry.draft ? <TimeStatusBadge status="DRAFT" label="Draft" /> : null}
      </div>
      <p className="text-muted-foreground text-sm">{[whenLabel(entry, now), timeText(entry), entry.location].filter(Boolean).join(" · ")}</p>
      {entry.detail ? <p className="text-muted-foreground text-xs">{entry.detail}</p> : null}
      {entry.description ? <RichText text={entry.description} className="text-sm" /> : null}
      <div className="flex flex-wrap gap-3 text-sm">
        {entry.link ? (
          <a href={entry.link} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 font-medium underline">
            Join online <ExternalLinkIcon className="size-3.5" aria-hidden />
          </a>
        ) : null}
        {entry.href ? (
          <Link href={entry.href as Route} className="text-primary font-medium underline">
            Open
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function MonthGrid({
  month,
  calendar,
  basePath,
  todayKey,
  selectedKey,
  entries,
}: {
  month: Date;
  calendar: SchoolCalendar;
  basePath: string;
  todayKey: string;
  selectedKey: string | null;
  /** Everything except holidays (those colour the day itself). */
  entries: CalendarEntry[];
}) {
  const first = month;
  const last = addDays(dateOnly(first.getUTCFullYear(), first.getUTCMonth() + 2, 1), -1);
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<Date | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: last.getUTCDate() }, (_, index) => addDays(first, index)),
  ];
  while (cells.length % 7) cells.push(null);

  const prev = monthKey(addDays(first, -1));
  const next = monthKey(addDays(last, 1));
  const thisMonth = monthKey(first);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{formatMonth(first)}</CardTitle>
        <div className="flex gap-1">
          <Button asChild variant="outline" size="sm">
            <Link href={`${basePath}` as Route}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Previous month">
            <Link href={`${basePath}?month=${prev}` as Route}>
              <ChevronLeftIcon className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Next month">
            <Link href={`${basePath}?month=${next}` as Route}>
              <ChevronRightIcon className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={formatMonth(first)}>
          {GRID_DAYS.map((day) => (
            <div key={day} className="text-muted-foreground py-1 font-medium" role="columnheader">
              {DAY_SHORT[day]}
            </div>
          ))}
          {cells.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} aria-hidden />;
            const closure = closureOn(calendar, date);
            const key = toDateInput(date);
            const onDay = entries.filter((entry) => entry.startDate <= date && date <= entry.endDate);
            const className = cn(
              "hover:border-primary focus-visible:ring-primary flex min-h-14 flex-col items-start gap-0.5 rounded-md border p-1 text-left outline-none focus-visible:ring-2",
              closure?.kind === "HOLIDAY" && "border-warning/30 bg-warning-soft",
              closure?.kind === "WEEKLY_OFF" && "bg-muted/60 text-muted-foreground",
              key === todayKey && "ring-primary ring-2",
              key === selectedKey && "border-primary bg-primary-soft/40",
            );
            return (
              <Link
                key={key}
                href={`${basePath}?month=${thisMonth}&day=${key}` as Route}
                role="gridcell"
                aria-label={`${key}${closure ? `, ${closure.label}` : ""}${onDay.length ? `, ${onDay.length} item${onDay.length === 1 ? "" : "s"}` : ""}. Show this day`}
                className={className}
              >
                <span className="font-medium tabular-nums">{date.getUTCDate()}</span>
                {closure?.kind === "HOLIDAY" ? <span className="text-warning-strong line-clamp-2 text-[11px] leading-tight">{closure.holiday.title}</span> : null}
                {onDay.slice(0, 2).map((entry) => (
                  <span key={entry.key} className={cn("line-clamp-1 rounded px-1 text-[10px] leading-tight", ENTRY_STYLE[entry.kind], entry.cancelled && "line-through opacity-70")}>
                    {entry.title}
                  </span>
                ))}
                {onDay.length > 2 ? <span className="text-muted-foreground text-[10px]">{`+${onDay.length - 2} more`}</span> : null}
              </Link>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-muted inline-block size-3 rounded-sm border" />
            Weekly off
          </span>
          {(Object.keys(ENTRY_STYLE) as CalendarKind[]).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block size-3 rounded-sm", ENTRY_STYLE[kind])} />
              {ENTRY_LABEL[kind]}
            </span>
          ))}
          <span>Tap a day to see its details.</span>
        </p>
      </CardContent>
    </Card>
  );
}

function HolidayRows({
  holidays,
  editable,
  now,
}: {
  holidays: Holiday[];
  editable: boolean;
  now: Date;
}) {
  return (
    <ul className="divide-y rounded-xl border">
      {holidays.map((holiday) => {
        const days = spanDays(holiday.startDate, holiday.endDate);
        const timeStatus = spanStatus(holiday.startDate, holiday.endDate, now);
        // Ended holidays are locked, so only running and upcoming ones link to the editor.
        const canEdit = editable && holiday.endDate >= now;
        return (
          <li key={holiday.id} className="flex flex-col gap-1 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {canEdit ? (
                <Link href={`/school-admin/holidays/${holiday.id}` as Route} className="font-semibold hover:underline">
                  {holiday.title}
                </Link>
              ) : (
                <h3 className="font-semibold">{holiday.title}</h3>
              )}
              <div className="flex items-center gap-2">
                <TimeStatusBadge
                  status={timeStatus === "COMPLETED" ? "PAST" : timeStatus === "ONGOING" ? "ONGOING" : "UPCOMING"}
                  label={timeStatus === "ONGOING" ? (holiday.startDate.getTime() === holiday.endDate.getTime() ? "Today" : "On now") : undefined}
                />
                <span className="text-muted-foreground text-sm tabular-nums">
                  {formatSpan(holiday.startDate, holiday.endDate)} · {pluralize(days, "day")}
                </span>
              </div>
            </div>
            {holiday.description ? <RichText text={holiday.description} className="text-muted-foreground text-sm" /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export async function HolidaysScreen({
  ctx,
  basePath,
  monthParam,
  dayParam,
  editable = false,
}: {
  ctx: TenantContext;
  basePath: string;
  monthParam?: string;
  /** "2026-10-11": show that day's items in full. */
  dayParam?: string;
  editable?: boolean;
}) {
  const now = today();
  const month = monthFrom(monthParam, now);
  const monthEnd = addDays(dateOnly(month.getUTCFullYear(), month.getUTCMonth() + 2, 1), -1);
  // The role's area, for links into events and meetings ("/teacher/holidays" → "/teacher").
  const base = basePath.replace(/\/holidays$/, "");
  const selected = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dateOnly(Number(dayParam.slice(0, 4)), Number(dayParam.slice(5, 7)), Number(dayParam.slice(8, 10))) : null;
  const [holidays, weeklyOffDays, entries, upcoming] = await Promise.all([listHolidays(ctx), getWeeklyOffDays(ctx), getCalendarEntries(ctx, month, monthEnd, base), upcomingEntries(ctx, 30, base)]);

  const nextHolidays = holidays.filter((holiday) => holiday.endDate >= now);
  const past = holidays.filter((holiday) => holiday.endDate < now).reverse();
  const dayEntries = selected ? (await getCalendarEntries(ctx, selected, selected, base)).filter((entry) => entry.startDate <= selected && selected <= entry.endDate) : [];
  const selectedKey = selected ? toDateInput(selected) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col gap-4">
        <MonthGrid month={month} calendar={{ weeklyOffDays, holidays }} basePath={basePath} todayKey={toDateInput(now)} selectedKey={selectedKey} entries={entries.filter((entry) => entry.kind !== "HOLIDAY")} />
        {selected ? (
          <Card>
            <CardHeader>
              <CardTitle>{formatDate(selected)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {dayEntries.length ? (
                <ul className="divide-y rounded-xl border">
                  {dayEntries.map((entry) => (
                    <EntryDetails key={entry.key} entry={entry} now={now} />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing on this day.</p>
              )}
              {editable && selected >= now ? (
                <div className="flex flex-wrap gap-3 text-sm">
                  {dayEntries.find((entry) => entry.kind === "HOLIDAY") ? (
                    <Link href={`/school-admin/holidays/${dayEntries.find((entry) => entry.kind === "HOLIDAY")!.key.slice(8)}` as Route} className="text-primary font-medium underline">
                      Edit this holiday
                    </Link>
                  ) : (
                    <Link href={`/school-admin/holidays/new?date=${selectedKey}` as Route} className="text-primary font-medium underline">
                      Add a holiday on this date
                    </Link>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3" aria-labelledby="coming-up">
          <h2 id="coming-up" className="font-semibold">
            Coming up — next 30 days
          </h2>
          {upcoming.length ? (
            <ul className="bg-card divide-y rounded-xl border">
              {upcoming.map((entry) => (
                <EntryDetails key={entry.key} entry={entry} now={now} />
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing coming up">Meetings, events, exams and holidays for you appear here as soon as the school adds them.</EmptyState>
          )}
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Upcoming holidays</h2>
          {nextHolidays.length ? (
            <HolidayRows holidays={nextHolidays} editable={editable} now={now} />
          ) : (
            <EmptyState title="No upcoming holidays">{editable ? "Add the school's holidays so registers and reports know when it is closed." : null}</EmptyState>
          )}
        </section>
        {past.length ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">Past holidays</h2>
            <HolidayRows holidays={past} editable={editable} now={now} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
