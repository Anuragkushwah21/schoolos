import type { Metadata, Route } from "next";
import Link from "next/link";
import { CalendarRangeIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, DAY_SHORT, dateOnly, formatDate, formatMonth, today, toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { type PlatformEntry, type PlatformEntryKind, platformCalendarEntries, platformReminders } from "@/server/platform/calendar";

export const metadata: Metadata = { title: "Calendar" };

const BASE = "/super-admin/calendar";
const GRID_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const STYLE: Record<PlatformEntryKind, string> = { TRIAL_ENDS: "bg-info-soft text-info-strong", PLAN_ENDS: "bg-warning-soft text-warning-strong" };
const LABEL: Record<PlatformEntryKind, string> = { TRIAL_ENDS: "Trial ends", PLAN_ENDS: "Plan ends" };

function monthFrom(value: string | undefined, fallback: Date): Date {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return dateOnly(Number(match[1]), Number(match[2]), 1);
  return dateOnly(fallback.getUTCFullYear(), fallback.getUTCMonth() + 1, 1);
}

const monthKey = (date: Date) => toDateInput(date).slice(0, 7);

function whenText(date: Date, now: Date): string {
  const days = Math.round((date.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days <= 14) return `In ${days} days · ${formatDate(date)}`;
  return formatDate(date);
}

function waitedText(since: Date | null, now: Date): string {
  if (!since) return "";
  const days = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
  return days === 0 ? "oldest from today" : `oldest waiting ${days} day${days === 1 ? "" : "s"}`;
}

function EntryRow({ entry, now }: { entry: PlatformEntry; now: Date }) {
  return (
    <li className="flex flex-col gap-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", STYLE[entry.kind])}>{LABEL[entry.kind]}</span>
        <Link href={entry.href} className="font-semibold hover:underline">
          {entry.title}
        </Link>
      </div>
      <p className="text-muted-foreground text-sm">{`${whenText(entry.date, now)} · ${entry.detail}`}</p>
    </li>
  );
}

/**
 * The Super Admin's calendar and reminders: plans and trials ending, what is
 * overdue, and requests waiting for a decision. Read-only — each item opens
 * the page where it is handled.
 */
export default async function PlatformCalendarPage(props: PageProps<"/super-admin/calendar">) {
  const user = await requireSuperAdmin();
  const search = await props.searchParams;
  const now = today();
  const month = monthFrom(param(search.month), now);
  const last = addDays(dateOnly(month.getUTCFullYear(), month.getUTCMonth() + 2, 1), -1);
  const dayParam = param(search.day);
  const selected = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dateOnly(Number(dayParam.slice(0, 4)), Number(dayParam.slice(5, 7)), Number(dayParam.slice(8, 10))) : null;

  const [entries, upcoming, reminders] = await Promise.all([platformCalendarEntries(user, month, last), platformCalendarEntries(user, now, addDays(now, 60)), platformReminders(user)]);

  const lead = (month.getUTCDay() + 6) % 7;
  const cells: Array<Date | null> = [...Array.from({ length: lead }, () => null), ...Array.from({ length: last.getUTCDate() }, (_, index) => addDays(month, index))];
  while (cells.length % 7) cells.push(null);
  const todayKey = toDateInput(now);
  const selectedKey = selected ? toDateInput(selected) : null;
  const dayEntries = selected ? (await platformCalendarEntries(user, selected, selected)) : [];

  return (
    <>
      <PageHeader icon={CalendarRangeIcon} tone="orange" title="Calendar" description="Plans and trials ending, what is overdue, and requests waiting for you." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>{formatMonth(month)}</CardTitle>
              <div className="flex gap-1">
                <Button asChild variant="outline" size="sm">
                  <Link href={BASE}>Today</Link>
                </Button>
                <Button asChild variant="outline" size="icon" aria-label="Previous month">
                  <Link href={`${BASE}?month=${monthKey(addDays(month, -1))}` as Route}>
                    <ChevronLeftIcon className="size-4" aria-hidden />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="icon" aria-label="Next month">
                  <Link href={`${BASE}?month=${monthKey(addDays(last, 1))}` as Route}>
                    <ChevronRightIcon className="size-4" aria-hidden />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={formatMonth(month)}>
                {GRID_DAYS.map((day) => (
                  <div key={day} className="text-muted-foreground py-1 font-medium" role="columnheader">
                    {DAY_SHORT[day]}
                  </div>
                ))}
                {cells.map((date, index) => {
                  if (!date) return <div key={`blank-${index}`} aria-hidden />;
                  const key = toDateInput(date);
                  const onDay = entries.filter((entry) => entry.date.getTime() === date.getTime());
                  return (
                    <Link
                      key={key}
                      href={`${BASE}?month=${monthKey(month)}&day=${key}` as Route}
                      role="gridcell"
                      aria-label={`${key}${onDay.length ? `, ${onDay.length} item${onDay.length === 1 ? "" : "s"}` : ""}. Show this day`}
                      className={cn(
                        "hover:border-primary focus-visible:ring-primary flex min-h-14 flex-col items-start gap-0.5 rounded-md border p-1 text-left outline-none focus-visible:ring-2",
                        key === todayKey && "ring-primary ring-2",
                        key === selectedKey && "border-primary bg-primary-soft/40",
                      )}
                    >
                      <span className="font-medium tabular-nums">{date.getUTCDate()}</span>
                      {onDay.slice(0, 2).map((entry) => (
                        <span key={entry.key} className={cn("line-clamp-1 rounded px-1 text-[10px] leading-tight", STYLE[entry.kind])}>
                          {entry.title}
                        </span>
                      ))}
                      {onDay.length > 2 ? <span className="text-muted-foreground text-[10px]">{`+${onDay.length - 2} more`}</span> : null}
                    </Link>
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {(Object.keys(STYLE) as PlatformEntryKind[]).map((kind) => (
                  <span key={kind} className="inline-flex items-center gap-1.5">
                    <span className={cn("inline-block size-3 rounded-sm", STYLE[kind])} />
                    {LABEL[kind]}
                  </span>
                ))}
                <span>Tap a day to see its details.</span>
              </p>
            </CardContent>
          </Card>
          {selected ? (
            <Card>
              <CardHeader>
                <CardTitle>{formatDate(selected)}</CardTitle>
              </CardHeader>
              <CardContent>
                {dayEntries.length ? (
                  <ul className="divide-y rounded-xl border">
                    {dayEntries.map((entry) => (
                      <EntryRow key={entry.key} entry={entry} now={now} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">Nothing on this day.</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          {reminders.overdue.length ? (
            <section className="flex flex-col gap-3" aria-labelledby="overdue">
              <h2 id="overdue" className="text-danger-strong font-semibold">
                Overdue
              </h2>
              <ul className="bg-card divide-y rounded-xl border">
                {reminders.overdue.map((row) => (
                  <li key={row.key} className="flex flex-col gap-1 p-3">
                    <Link href={row.href} className="font-semibold hover:underline">
                      {row.title}
                    </Link>
                    <p className="text-danger-strong text-sm">{row.date ? `${row.text} · ${formatDate(row.date)}` : row.text}</p>
                    <p className="text-muted-foreground text-xs">{row.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="flex flex-col gap-3" aria-labelledby="waiting">
            <h2 id="waiting" className="font-semibold">
              Waiting for you
            </h2>
            {reminders.waiting.length ? (
              <ul className="bg-card divide-y rounded-xl border">
                {reminders.waiting.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <Link href={row.href} className="font-medium hover:underline">
                      {`${row.count} ${row.label}`}
                    </Link>
                    <span className="text-muted-foreground text-xs">{waitedText(row.oldest, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing waiting">Approvals, campus, plan and feature requests and new enquiries appear here until you decide them.</EmptyState>
            )}
          </section>
          <section className="flex flex-col gap-3" aria-labelledby="coming-up">
            <h2 id="coming-up" className="font-semibold">
              Coming up — next 60 days
            </h2>
            {upcoming.length ? (
              <ul className="bg-card divide-y rounded-xl border">
                {upcoming.map((entry) => (
                  <EntryRow key={entry.key} entry={entry} now={now} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing ending soon">Plans and trials with an end date appear here before they end.</EmptyState>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
