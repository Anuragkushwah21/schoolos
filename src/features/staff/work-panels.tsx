import type { Route } from "next";
import Link from "next/link";
import { BusIcon, ClipboardCheckIcon, WalletIcon } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, minutesToTime } from "@/lib/dates";
import { formatMoney, humanize } from "@/lib/format";
import type { feeDeskToday, myStaffAttendance } from "@/server/staff/portal";
import type { myAssignedRoutes } from "@/server/transport/driver";

/**
 * Work panels on the staff dashboard. Each one is shown only when the page
 * has already fetched its data under the right check (own record, own
 * assignment, or a granted permission) — the panel itself decides nothing.
 */

const DAY_TONE = { PRESENT: "positive", LATE: "warning", ABSENT: "negative", ON_LEAVE: "info" } as const;
const DAY_LABEL = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", ON_LEAVE: "On leave" } as const;

/** Today's mark and the last 30 days, from the staff member's own register. */
export function MyAttendanceCard({ attendance, todayIso }: { attendance: Awaited<ReturnType<typeof myStaffAttendance>>; todayIso: string }) {
  const mark = attendance.rows.find((row) => row.date.toISOString().slice(0, 10) === todayIso);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardCheckIcon className="text-success-strong size-4" aria-hidden />
          My attendance
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Today</span>
          {mark ? <StatusBadge status={mark.status} tone={DAY_TONE[mark.status]} label={DAY_LABEL[mark.status]} /> : <span className="text-muted-foreground text-xs">Not marked yet</span>}
        </div>
        <dl className="grid grid-cols-4 gap-2 text-center">
          {(Object.keys(DAY_LABEL) as Array<keyof typeof DAY_LABEL>).map((status) => (
            <div key={status} className="bg-muted/50 rounded-lg px-1 py-2">
              <dt className="text-muted-foreground text-[11px]">{DAY_LABEL[status]}</dt>
              <dd className="font-semibold tabular-nums">{attendance.counts[status]}</dd>
            </div>
          ))}
        </dl>
        <Link href="/staff/attendance" className="text-primary text-xs font-medium hover:underline">
          Last 30 days →
        </Link>
      </CardContent>
    </Card>
  );
}

/** Today's collection at the fee desk. */
export function FeeDeskTodayPanel({ desk, canCollect = true }: { desk: Awaited<ReturnType<typeof feeDeskToday>>; canCollect?: boolean }) {
  return (
    <section aria-labelledby="fees-today" className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="fees-today" className="text-base font-semibold">
          Today&apos;s fee desk
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/staff/fees">
              <WalletIcon aria-hidden />
              {canCollect ? "Collect fee" : "Pending fees"}
            </Link>
          </Button>
          {canCollect ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/staff/fees/family">Family payment</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Collected today" value={formatMoney(desk.totalMinor)} hint={`${desk.receipts} ${desk.receipts === 1 ? "receipt" : "receipts"}`} />
        <Stat label="Taken by you" value={formatMoney(desk.myTotalMinor)} hint={`${desk.myReceipts} ${desk.myReceipts === 1 ? "receipt" : "receipts"}`} />
        <Card size="sm" className="sm:row-span-1">
          <CardContent>
            <p className="text-muted-foreground mb-1 text-xs">Latest receipts</p>
            {desk.recent.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {desk.recent.slice(0, 3).map((row) => (
                  <li key={row.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">{row.student}</span>
                    <span className="tabular-nums">{formatMoney(row.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">None yet today.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

/**
 * The routes this person works today — their own, or one they cover as a
 * substitute — as a timeline: each stop with its time and how many students
 * board there. Opening a route (or a stop) shows those students only.
 */
export function MyRoutesPanel({ routes, heading = true }: { routes: Awaited<ReturnType<typeof myAssignedRoutes>>; heading?: boolean }) {
  return (
    <section aria-labelledby={heading ? "my-route" : undefined} className="mb-6 flex flex-col gap-3">
      {heading ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="my-route" className="text-base font-semibold">
            Today&apos;s {routes.length === 1 ? "route" : "routes"}
          </h2>
          <Link href="/staff/my-route" className="text-primary text-sm font-medium hover:underline">
            Open →
          </Link>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {routes.map((route) => (
          <Card key={route.id} size="sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <BusIcon className="text-primary-strong size-4" aria-hidden />
                {route.code ? <span className="bg-primary-soft text-primary-strong rounded-md px-1.5 py-0.5 text-xs font-bold">{route.code}</span> : null}
                <Link href={`/staff/my-route/${route.id}` as Route} className="hover:underline">
                  {route.name}
                </Link>
                {route.as === "SUBSTITUTE" ? <span className="bg-warning-soft text-warning-strong rounded-full px-2 py-0.5 text-xs font-semibold">Covering for {route.coveringFor}</span> : null}
              </CardTitle>
              <CardDescription>
                {route.as === "DRIVER" ? "You drive" : route.as === "ATTENDANT" ? "You attend" : `Until ${route.until ? formatDate(route.until) : "—"}`} ·{" "}
                {route.vehicle ? `${route.vehicle.registrationNo} (${humanize(route.vehicle.type)}, ${route.vehicle.capacity} seats)` : "no vehicle assigned"} · {route.riders}{" "}
                {route.riders === 1 ? "student" : "students"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {route.startPoint || route.endPoint ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">From</span> <strong>{route.startPoint ?? "—"}</strong> <span className="text-muted-foreground">to</span>{" "}
                  <strong>{route.endPoint ?? "—"}</strong>
                </p>
              ) : null}
              {route.crew.map((member) => (
                <p key={member.role} className="text-muted-foreground text-xs">
                  {member.role}: {member.name}
                  {member.phone ? ` · ${member.phone}` : ""}
                </p>
              ))}
              {route.vehicle && route.vehicle.status !== "ACTIVE" ? (
                <p className="text-warning-strong text-xs">Vehicle is marked {humanize(route.vehicle.status).toLowerCase()}.</p>
              ) : null}
              {route.notes ? <p className="bg-muted/50 rounded-lg p-2 text-xs whitespace-pre-line">{route.notes}</p> : null}
              {route.stops.length ? (
                <ol className="relative flex flex-col gap-0.5 border-l-2 border-dashed pl-4">
                  {route.stops.map((stop) => (
                    <li key={stop.id} className="relative">
                      <span className="bg-primary ring-background absolute top-2.5 -left-[1.3rem] size-2.5 rounded-full ring-2" aria-hidden />
                      <Link href={`/staff/my-route/${route.id}?stop=${stop.id}` as Route} className="hover:bg-muted/60 flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
                        <span className="text-muted-foreground w-12 shrink-0 text-xs tabular-nums">{stop.pickupMinute != null ? minutesToTime(stop.pickupMinute) : "—"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{stop.name}</span>
                          {stop.location ? <span className="text-muted-foreground block truncate text-xs">{stop.location}</span> : null}
                        </span>
                        <span className="bg-primary-soft text-primary-strong shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
                          {stop.riders} {stop.riders === 1 ? "student" : "students"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted-foreground text-sm">No stops on this route — it runs from start to end.</p>
              )}
              {route.unassignedRiders ? <p className="text-muted-foreground text-xs">{route.unassignedRiders} more with no stop set.</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
