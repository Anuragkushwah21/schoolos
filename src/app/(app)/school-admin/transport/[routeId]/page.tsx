import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { ActionForm } from "@/components/forms/action-form";
import { SelectField, SubmitButton, TextField } from "@/components/forms/fields";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { assignTransportAction, removeStopAction, removeTransportAction } from "@/features/operations/actions";
import { RouteForm, StopForm } from "@/features/operations/forms";
import { formatMinutes, today, toDateInput } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { orNotFound } from "@/server/page-helpers";
import { staffOptions } from "@/server/operations/staff";
import { listRoutes, listVehicles, routeRiders } from "@/server/operations/transport";
import { NotFoundError } from "@/lib/errors";

export const metadata: Metadata = { title: "Route" };

export default async function RoutePage(props: PageProps<"/school-admin/transport/[routeId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { routeId } = await props.params;
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);
  const route = await orNotFound(
    listRoutes(ctx).then((routes) => {
      const found = routes.find((row) => row.id === routeId);
      if (!found) throw new NotFoundError();
      return found;
    }),
  );
  const [riders, vehicles, drivers, attendants, sections] = await Promise.all([
    routeRiders(ctx, route.id),
    listVehicles(ctx),
    staffOptions(ctx, ["DRIVER"]),
    staffOptions(ctx, ["TRANSPORT_ATTENDANT"]),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
  ]);
  const sectionId = sections.find((row) => row.value === param(search.section))?.value;
  const candidates =
    sectionId && session
      ? await ctx.db.studentEnrollment.findMany({
          where: { sectionId, academicSessionId: session.id, status: "ACTIVE", student: { status: "ACTIVE" } },
          orderBy: { student: { firstName: "asc" } },
          select: { student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, transport: { select: { route: { select: { name: true } } } } } } },
        })
      : [];

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/transport", label: "Transport" }}
        title={route.name}
        description={`${route.riders}${route.vehicle ? ` of ${route.vehicle.capacity}` : ""} seats used`}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stops</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {route.stops.length ? (
              <ol className="divide-y text-sm">
                {route.stops.map((stop) => (
                  <li key={stop.id} className="flex items-center gap-3 py-2">
                    <span className="w-6 tabular-nums">{stop.sequence}.</span>
                    <span className="flex-1">{stop.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {stop.pickupMinute !== null ? formatMinutes(stop.pickupMinute) : "—"} / {stop.dropMinute !== null ? formatMinutes(stop.dropMinute) : "—"}
                    </span>
                    <ActionButton action={removeStopAction} fields={{ stopId: stop.id }} variant="ghost" size="xs" confirm={{ title: `Remove ${stop.name}?`, description: "Only a stop nobody boards at can be removed.", confirmLabel: "Remove" }}>
                      Remove
                    </ActionButton>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">No stops yet.</p>
            )}
            <StopForm routeId={route.id} nextSequence={(route.stops.at(-1)?.sequence ?? 0) + 1} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Route details</CardTitle>
          </CardHeader>
          <CardContent>
            <RouteForm
              route={{ id: route.id, name: route.name, vehicleId: route.vehicle?.id ?? null, driverId: route.driver?.id ?? null, attendantId: route.attendant?.id ?? null, isActive: route.isActive, notes: route.notes }}
              vehicles={vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.registrationNo} (${vehicle.capacity} seats)` }))}
              drivers={drivers}
              attendants={attendants}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Add students</CardTitle>
          <CardDescription>Choose a section, tick students, pick their stop. A student on another route is moved here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FilterBar action={`/school-admin/transport/${route.id}`} selects={[{ name: "section", label: "Section", defaultValue: sectionId, allLabel: "Choose a section", options: sections }]} />
          {candidates.length ? (
            <ActionForm action={assignTransportAction}>
              <input type="hidden" name="routeId" value={route.id} />
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {candidates.map(({ student }) => (
                  <li key={student.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="studentIds" value={student.id} className="accent-primary size-4" />
                      {fullName(student)}
                      <span className="text-muted-foreground text-xs">{student.transport ? `· on ${student.transport.route.name}` : ""}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-3">
                <SelectField name="stopId" label="Stop" options={route.stops.map((stop) => ({ value: stop.id, label: stop.name }))} placeholder="No stop yet" className="w-56" />
                <TextField name="startDate" label="From" type="date" defaultValue={toDateInput(today())} />
                <SubmitButton pendingLabel="Assigning…">Assign selected</SubmitButton>
              </div>
            </ActionForm>
          ) : sectionId ? (
            <EmptyState title="No active students in this section" />
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Riders</CardTitle>
        </CardHeader>
        <CardContent>
          {riders.length ? (
            <ul className="divide-y text-sm">
              {riders.map((rider) => (
                <li key={rider.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{rider.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {rider.admissionNumber}
                      {rider.section ? ` · ${rider.section}` : ""}
                      {rider.guardian ? ` · ${fullName(rider.guardian)} ${rider.guardian.phone}` : ""}
                    </span>
                  </span>
                  <span className="text-muted-foreground">{rider.stop ?? "No stop"}{rider.pickup !== null ? ` · ${formatMinutes(rider.pickup)}` : ""}</span>
                  <ActionButton action={removeTransportAction} fields={{ studentId: rider.studentId }} variant="ghost" size="xs" confirm={{ title: `Take ${rider.name} off transport?`, description: "They can be assigned again later.", confirmLabel: "Remove" }}>
                    Remove
                  </ActionButton>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nobody rides this route yet" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
