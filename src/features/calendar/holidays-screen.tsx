import type { Route } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { RichText } from "@/components/shared/rich-text";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { closureOn, formatSpan, type SchoolCalendar, spanDays } from "@/lib/calendar";
import { spanStatus } from "@/lib/time-status";
import { addDays, DAY_SHORT, dateOnly, formatMonth, today, toDateInput } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TenantContext } from "@/server/auth/current-user";
import { type CalendarEntry, getCalendarEntries } from "@/server/calendar/entries";
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

const ENTRY_STYLE = {
  // The same colours as each area's own pages: events blue, exams purple,
  // meetings cyan; holidays are the amber days themselves.
  EVENT: "bg-primary-soft text-primary-strong",
  EXAM: "bg-purple-soft text-purple-strong",
  MEETING: "bg-info-soft text-info-strong",
} as const;
const ENTRY_LABEL = { EVENT: "Event", EXAM: "Exam", MEETING: "Meeting" } as const;

function MonthGrid({
  month,
  calendar,
  basePath,
  todayKey,
  editable,
  entries,
}: {
  month: Date;
  calendar: SchoolCalendar;
  basePath: string;
  todayKey: string;
  /** Events, exams and meetings to mark on the days they fall on. */
  entries: CalendarEntry[];
  /**
   * School Admin only: today and later dates become links — a free day opens
   * the new-holiday form on that date, a holiday day opens that holiday.
   * Past days stay plain, since holidays cannot be placed in the past.
   */
  editable: boolean;
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{formatMonth(first)}</CardTitle>
        <div className="flex gap-1">
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
            const upcoming = key >= todayKey;
            const href: Route | null =
              editable && upcoming
                ? closure?.kind === "HOLIDAY"
                  ? (`/school-admin/holidays/${closure.holiday.id}` as Route)
                  : (`/school-admin/holidays/new?date=${key}` as Route)
                : null;
            const className = cn(
              "flex min-h-14 flex-col items-start gap-0.5 rounded-md border p-1 text-left",
              closure?.kind === "HOLIDAY" && "border-warning/30 bg-warning-soft",
              closure?.kind === "WEEKLY_OFF" && "bg-muted/60 text-muted-foreground",
              key === todayKey && "ring-primary ring-2",
              editable && !upcoming && "opacity-60",
              href && "hover:border-primary focus-visible:ring-primary cursor-pointer outline-none focus-visible:ring-2",
            );
            const body = (
              <>
                <span className="font-medium tabular-nums">{date.getUTCDate()}</span>
                {closure?.kind === "HOLIDAY" ? (
                  <span className="line-clamp-2 text-[11px] leading-tight text-warning-strong">
                    {closure.holiday.title}
                  </span>
                ) : null}
                {entries
                  .filter((entry) => entry.startDate <= date && date <= entry.endDate)
                  .slice(0, 2)
                  .map((entry) => (
                    <span key={`${entry.kind}-${entry.title}`} className={cn("line-clamp-1 rounded px-1 text-[10px] leading-tight", ENTRY_STYLE[entry.kind])}>
                      {entry.title}
                    </span>
                  ))}
                <span className="sr-only">
                  {closure ? closure.label : "Working day"}
                  {href ? (closure?.kind === "HOLIDAY" ? ". Edit this holiday" : ". Add a holiday on this date") : ""}
                </span>
              </>
            );
            return href ? (
              <Link key={key} href={href} role="gridcell" title={closure?.label ?? "Add a holiday"} className={className}>
                {body}
              </Link>
            ) : (
              <div key={key} role="gridcell" title={closure?.label} className={className}>
                {body}
              </div>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm border border-warning/30 bg-warning-soft" />
            Holiday
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-muted inline-block size-3 rounded-sm border" />
            Weekly off
          </span>
          {(Object.keys(ENTRY_STYLE) as Array<keyof typeof ENTRY_STYLE>).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block size-3 rounded-sm", ENTRY_STYLE[kind])} />
              {ENTRY_LABEL[kind]}
            </span>
          ))}
          {editable ? <span>Click today or a later date to add a holiday.</span> : null}
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
  editable = false,
}: {
  ctx: TenantContext;
  basePath: string;
  monthParam?: string;
  editable?: boolean;
}) {
  const now = today();
  const month = monthFrom(monthParam, now);
  const monthEnd = addDays(dateOnly(month.getUTCFullYear(), month.getUTCMonth() + 2, 1), -1);
  const [holidays, weeklyOffDays, entries] = await Promise.all([
    listHolidays(ctx),
    getWeeklyOffDays(ctx),
    getCalendarEntries(ctx, month, monthEnd),
  ]);

  const upcoming = holidays.filter((holiday) => holiday.endDate >= now);
  const past = holidays.filter((holiday) => holiday.endDate < now).reverse();

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col gap-4">
        <MonthGrid
          month={month}
          calendar={{ weeklyOffDays, holidays }}
          basePath={basePath}
          todayKey={toDateInput(now)}
          editable={editable}
          entries={entries}
        />
        <Card>
          <CardHeader>
            <CardTitle>{formatMonth(month)} at a glance</CardTitle>
          </CardHeader>
          <CardContent>
            {entries.length ? (
              <ul className="divide-y text-sm">
                {entries.map((entry) => (
                  <li key={`${entry.kind}-${entry.title}-${entry.startDate.getTime()}`} className="flex items-center gap-3 py-2">
                    <span className={cn("w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-medium", ENTRY_STYLE[entry.kind])}>
                      {ENTRY_LABEL[entry.kind]}
                    </span>
                    <span className="min-w-0 flex-1">{entry.title}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">{formatSpan(entry.startDate, entry.endDate)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No events, exams or meetings this month.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Upcoming holidays</h2>
          {upcoming.length ? (
            <HolidayRows holidays={upcoming} editable={editable} now={now} />
          ) : (
            <EmptyState title="No upcoming holidays">
              {editable ? "Add the school's holidays so registers and reports know when it is closed." : null}
            </EmptyState>
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
