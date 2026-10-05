import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BusIcon, PhoneIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RouteIssueForm, TripButtons } from "@/features/staff/access-forms";
import { formatDate, formatDateTime, minutesToTime } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";
import { myAssignedRoutes, myRouteHistory, myRouteRiders } from "@/server/transport/driver";

export const metadata: Metadata = { title: "Route" };

const STATUS = {
  PICKED_UP: { label: "Picked up", tone: "positive" },
  DROPPED: { label: "Dropped", tone: "positive" },
  NOT_PRESENT: { label: "Not present", tone: "warning" },
  ISSUE: { label: "Issue", tone: "negative" },
} as const;

/**
 * One of my routes: today's pickup list and drop list, stop by stop, with
 * only the students on this route (or one stop of it). Marking is for today
 * only. History shows the last two weeks; issues go to the school office.
 */
export default async function MyRouteDetailPage(props: PageProps<"/staff/my-route/[routeId]">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "transport.myroute");
  const { routeId } = await props.params;
  const search = await props.searchParams;
  const route = (await myAssignedRoutes(ctx)).find((row) => row.id === routeId);
  // Not one of theirs (or not a route at all): nothing to show either way.
  if (!route) notFound();

  const grants: string[] = await staffGrants(ctx);
  const view = param(search.view) === "history" ? "history" : param(search.trip) === "drop" ? "drop" : "pickup";
  const trip = view === "drop" ? ("DROP" as const) : ("PICKUP" as const);
  const stopId = route.stops.find((stop) => stop.id === param(search.stop))?.id ?? null;
  const canSeeRiders = grants.includes("transport.riders");
  const canMark = grants.includes("transport.trips");
  const [riders, history] = await Promise.all([
    canSeeRiders && view !== "history" ? myRouteRiders(ctx, route.id, { stopId }) : null,
    view === "history" ? myRouteHistory(ctx, route.id) : null,
  ]);
  const base = `/staff/my-route/${route.id}`;
  const link = (next: { trip?: string; stop?: string | null; view?: string }) => {
    const params = new URLSearchParams();
    if (next.view) params.set("view", next.view);
    if (next.trip === "drop") params.set("trip", "drop");
    if (next.stop) params.set("stop", next.stop);
    const query = params.toString();
    return (query ? `${base}?${query}` : base) as Route;
  };
  const marked = riders?.riders.filter((row) => (trip === "PICKUP" ? row.pickup : row.drop)).length ?? 0;

  return (
    <>
      <PageHeader
        icon={BusIcon}
        tone="amber"
        back={{ href: "/staff/my-route", label: "My route" }}
        title={`${route.code ? `${route.code} · ` : ""}${route.name}`}
        description={[
          route.startPoint || route.endPoint ? `${route.startPoint ?? "—"} → ${route.endPoint ?? "—"}` : null,
          route.vehicle ? route.vehicle.registrationNo : "No vehicle",
          route.as === "SUBSTITUTE" ? `Covering for ${route.coveringFor}${route.until ? ` until ${formatDate(route.until)}` : ""}` : route.as === "DRIVER" ? "You drive" : "You attend",
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <ViewTabs
        label="Route views"
        tabs={[
          { href: link({ trip: "pickup", stop: stopId }), label: "Pickup list", active: view === "pickup" },
          { href: link({ trip: "drop", stop: stopId }), label: "Drop list", active: view === "drop" },
          { href: link({ view: "history" }), label: "Route history", active: view === "history" },
        ]}
      />

      {view !== "history" ? (
        <>
          {route.stops.length ? (
            <div className="mb-4 flex flex-wrap gap-2 text-sm">
              <Link href={link({ trip: view, stop: null })} className={`rounded-full border px-3 py-1 ${!stopId ? "border-primary bg-primary-soft" : "hover:border-primary/50"}`}>
                All stops <span className="text-muted-foreground tabular-nums">{route.riders}</span>
              </Link>
              {route.stops.map((stop) => (
                <Link key={stop.id} href={link({ trip: view, stop: stop.id })} className={`rounded-full border px-3 py-1 ${stopId === stop.id ? "border-primary bg-primary-soft" : "hover:border-primary/50"}`}>
                  {(trip === "PICKUP" ? stop.pickupMinute : stop.dropMinute) != null ? `${minutesToTime((trip === "PICKUP" ? stop.pickupMinute : stop.dropMinute)!)} · ` : ""}
                  {stop.name} <span className="text-muted-foreground tabular-nums">{stop.riders}</span>
                </Link>
              ))}
            </div>
          ) : null}

          {!canSeeRiders ? (
            <EmptyState title="Student list not enabled">The school office has not given you the student list for your route.</EmptyState>
          ) : riders && riders.riders.length ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {trip === "PICKUP" ? "Pickup" : "Drop"} · {riders.riders.length} {riders.riders.length === 1 ? "student" : "students"}
                </CardTitle>
                <CardDescription>
                  {marked} of {riders.riders.length} marked today.{canMark ? "" : " You can see this list but not mark it."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {riders.riders.map((rider) => {
                    const mark = trip === "PICKUP" ? rider.pickup : rider.drop;
                    const minute = trip === "PICKUP" ? rider.stop?.pickupMinute : rider.stop?.dropMinute;
                    return (
                      <li key={rider.studentId} className="flex flex-wrap items-center gap-3 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{rider.name}</span>
                          <span className="text-muted-foreground block text-xs">
                            {rider.section ?? "Not placed"} · {rider.stop ? `${rider.stop.name}${minute != null ? ` ${minutesToTime(minute)}` : ""}` : "No stop set"}
                          </span>
                          {rider.guardian ? (
                            <a href={`tel:${rider.guardian.phone.replace(/\s/g, "")}`} className="text-primary mt-0.5 inline-flex items-center gap-1 text-xs">
                              <PhoneIcon className="size-3" aria-hidden />
                              {rider.guardian.name} ({humanize(rider.guardian.relationship).toLowerCase()}) · {rider.guardian.phone}
                            </a>
                          ) : null}
                          {mark?.note ? <span className="text-danger-strong block text-xs">{mark.note}</span> : null}
                        </span>
                        {mark ? <StatusBadge status={mark.status} tone={STATUS[mark.status].tone} label={`${STATUS[mark.status].label} · ${formatDateTime(mark.markedAt).split(", ").at(-1)}`} /> : null}
                        {canMark ? <TripButtons routeId={route.id} studentId={rider.studentId} trip={trip} current={mark?.status ?? null} /> : null}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : (
            <EmptyState title={stopId ? "Nobody boards at this stop" : "No students on this route yet"} />
          )}
        </>
      ) : history && history.length ? (
        <Card>
          <CardContent className="pt-6">
            <ul className="divide-y text-sm">
              {history.map((day) => (
                <li key={day.date.toISOString()} className="py-2.5">
                  <span className="font-medium">{formatDate(day.date)}</span>
                  <span className="text-muted-foreground"> · {day.pickedUp} picked up · {day.notPresent} not present · {day.dropped} dropped{day.issues ? ` · ${day.issues} issues` : ""}</span>
                  {day.notes.map((note) => (
                    <span key={note} className="text-danger-strong block text-xs">
                      {note}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : view === "history" ? (
        <EmptyState title="Nothing recorded in the last two weeks" />
      ) : null}

      <Card className="mt-6 max-w-xl">
        <CardHeader>
          <CardTitle>Report an issue</CardTitle>
          <CardDescription>A breakdown, a closed road, a delay — the school office sees it on this route.</CardDescription>
        </CardHeader>
        <CardContent>
          <RouteIssueForm routeId={route.id} />
        </CardContent>
      </Card>
    </>
  );
}
