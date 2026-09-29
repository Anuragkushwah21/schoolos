import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";
import { listRoutes } from "@/server/operations/transport";

export const metadata: Metadata = { title: "Transport" };

/** Read-only routes and stops for staff granted VIEW_TRANSPORT. */
export default async function StaffTransportPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "VIEW_TRANSPORT");
  const routes = await listRoutes(ctx);

  return (
    <>
      <PageHeader title="Transport" description="Routes, vehicles, crews and stops. Read-only — changes are made by the school office." />
      {routes.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {routes.map((route) => (
            <Card key={route.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {route.name}
                  {route.isActive ? null : <StatusBadge status="INACTIVE" label="Not running" tone="neutral" />}
                </CardTitle>
                <CardDescription>
                  {route.vehicle ? `${route.vehicle.registrationNo} · ${route.riders}/${route.vehicle.capacity} seats` : `No vehicle · ${route.riders} riders`}
                  {route.driver ? ` · Driver ${fullName(route.driver)}${route.driver.phone ? ` (${route.driver.phone})` : ""}` : ""}
                  {route.attendant ? ` · Attendant ${fullName(route.attendant)}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {route.stops.length ? (
                  <ol className="flex flex-col gap-1 text-sm">
                    {route.stops.map((stop) => (
                      <li key={stop.id} className="flex justify-between gap-3">
                        <span>
                          {stop.sequence}. {stop.name}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {stop.pickupMinute !== null ? formatMinutes(stop.pickupMinute) : "—"}
                          {stop.dropMinute !== null ? ` / ${formatMinutes(stop.dropMinute)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-muted-foreground text-sm">No stops yet.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No routes yet" />
      )}
    </>
  );
}
