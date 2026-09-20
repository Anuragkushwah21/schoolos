import { CheckIcon, ClockIcon, UsersIcon } from "lucide-react";

/**
 * An illustration of the admin dashboard, drawn in HTML so it stays sharp at
 * every size and follows the theme. It depicts the product; the figures in it
 * are illustrative and read from no database.
 */

const WEEK = [
  { day: "Mon", value: 94 },
  { day: "Tue", value: 91 },
  { day: "Wed", value: 96 },
  { day: "Thu", value: 89 },
  { day: "Fri", value: 93 },
];

const PERIODS = [
  { time: "9:00", subject: "Mathematics", section: "10-A", done: true },
  { time: "10:00", subject: "Science", section: "9-B", done: true },
  { time: "11:00", subject: "English", section: "10-A", done: false },
];

export function ProductPreview() {
  return (
    <div className="relative" aria-hidden>
      <div className="from-primary/25 absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr via-sky-300/20 to-amber-200/30 blur-2xl dark:via-sky-500/10 dark:to-amber-500/10" />

      <div className="bg-card ring-foreground/10 overflow-hidden rounded-2xl shadow-2xl ring-1">
        {/* window chrome */}
        <div className="bg-muted/60 flex items-center gap-2 border-b px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-400" />
          <span className="text-muted-foreground ml-3 truncate text-[11px]">
            schoolos.app/admin
          </span>
        </div>

        <div className="grid gap-4 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-[11px]">Greenfield Public School</p>
              <p className="text-sm font-semibold">Good morning, Principal</p>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              Session 2026-27
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Students", value: "1,248" },
              { label: "Teachers", value: "64" },
              { label: "Present today", value: "93%" },
            ].map((stat) => (
              <div key={stat.label} className="bg-background rounded-xl border p-3">
                <p className="text-muted-foreground text-[10px] sm:text-[11px]">{stat.label}</p>
                <p className="mt-1 text-base font-semibold tabular-nums sm:text-lg">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1.15fr_1fr]">
            <div className="bg-background rounded-xl border p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium">
                <UsersIcon className="text-primary size-3.5" />
                Attendance this week
              </p>
              <div className="mt-3 flex h-24 items-end gap-2">
                {WEEK.map((bar) => (
                  <div key={bar.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <div
                      className="bg-primary/85 w-full rounded-t-md"
                      style={{ height: `${(bar.value - 80) * 4.5}%` }}
                    />
                    <span className="text-muted-foreground text-[10px]">{bar.day}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-background rounded-xl border p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium">
                <ClockIcon className="text-primary size-3.5" />
                Today&apos;s periods
              </p>
              <ul className="mt-2 grid gap-1.5">
                {PERIODS.map((period) => (
                  <li
                    key={period.time}
                    className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-[11px]"
                  >
                    <span className="text-muted-foreground w-9 tabular-nums">{period.time}</span>
                    <span className="flex-1 truncate">
                      {period.subject} · {period.section}
                    </span>
                    {period.done ? (
                      <CheckIcon className="size-3.5 text-emerald-600" />
                    ) : (
                      <span className="bg-primary size-1.5 rounded-full" />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* floating notification */}
      <div className="bg-card ring-foreground/10 absolute -bottom-12 -left-5 hidden w-60 rounded-xl p-3 shadow-xl ring-1 sm:block">
        <p className="text-[11px] font-medium">Attendance marked · Class 10-A</p>
        <p className="text-muted-foreground mt-0.5 text-[11px]">38 of 40 present · 2 absent</p>
      </div>
    </div>
  );
}
