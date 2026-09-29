import { BusIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importTransportAction } from "@/features/operations/actions";
import { RouteForm, VehicleForm } from "@/features/operations/forms";
import { CsvImportForm } from "@/features/operations/import-form";
import { fullName, humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { staffOptions } from "@/server/operations/staff";
import { listRoutes, listVehicles } from "@/server/operations/transport";

export const metadata: Metadata = { title: "Transport" };

export default async function TransportPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [routes, vehicles, drivers, attendants] = await Promise.all([
    listRoutes(ctx),
    listVehicles(ctx),
    staffOptions(ctx, ["DRIVER"]),
    staffOptions(ctx, ["TRANSPORT_ATTENDANT"]),
  ]);
  const vehicleOptions = vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.registrationNo} (${vehicle.capacity} seats)` }));

  return (
    <>
      <PageHeader icon={BusIcon} tone="amber"
        title="Transport"
        description="Routes, stops, vehicles, drivers and which students ride. Drivers and attendants are added under Staff."
        actions={
          <Button asChild variant="outline">
            <Link href="/school-admin/reports/export?kind=transport" prefetch={false}>
              Export CSV
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Routes</CardTitle>
          </CardHeader>
          <CardContent>
            {routes.length ? (
              <ul className="divide-y">
                {routes.map((route) => (
                  <li key={route.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <Link href={`/school-admin/transport/${route.id}` as Route} className="font-medium hover:underline">
                        {route.name}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {route.vehicle ? route.vehicle.registrationNo : "No vehicle"} · {route.driver ? fullName(route.driver) : "No driver"} ·{" "}
                        {route.stops.length} stops
                      </span>
                    </span>
                    <span className="text-sm tabular-nums">
                      {route.riders}
                      {route.vehicle ? `/${route.vehicle.capacity}` : ""} riders
                    </span>
                    {!route.isActive ? <StatusBadge status="INACTIVE" /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No bus routes yet.">Add a vehicle, then a route with its stops — students can then be assigned to it.</EmptyState>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>New route</CardTitle>
            </CardHeader>
            <CardContent>
              <RouteForm vehicles={vehicleOptions} drivers={drivers} attendants={attendants} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Vehicles</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {vehicles.length ? (
                <ul className="divide-y text-sm">
                  {vehicles.map((vehicle) => (
                    <li key={vehicle.id} className="flex items-center gap-3 py-2">
                      <span className="flex-1">
                        {vehicle.registrationNo} · {humanize(vehicle.type)} · {vehicle.capacity} seats
                        <span className="text-muted-foreground block text-xs">{vehicle.routes.map((route) => route.name).join(", ") || "Not on a route"}</span>
                      </span>
                      <StatusBadge status={vehicle.status} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <VehicleForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Assign students from CSV</CardTitle>
              <CardDescription>
                <Link href="/school-admin/reports/export?kind=template-transport" prefetch={false} className="underline">
                  Template
                </Link>
                : admission no., route, stop. Vehicle capacity is checked for the whole file.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CsvImportForm action={importTransportAction} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
