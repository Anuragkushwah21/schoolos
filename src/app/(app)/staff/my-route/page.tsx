import { BusIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { MyRoutesPanel } from "@/features/staff/work-panels";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";
import { myAssignedRoutes } from "@/server/transport/driver";

export const metadata: Metadata = { title: "My route" };

/**
 * The route a driver or attendant runs, as the School Admin set it up: start
 * and end, vehicle, crew, notes and the stops in order. Only their own route —
 * the school's other routes need "View transport".
 */
export default async function MyRoutePage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "transport.myroute");
  const routes = await myAssignedRoutes(ctx);
  return (
    <>
      <PageHeader icon={BusIcon} tone="amber" title="My route" description="Today's route, stops and students — your own, or one you cover as a substitute. Open a stop to see who boards there." />
      {routes.length ? (
        <MyRoutesPanel routes={routes} heading={false} />
      ) : (
        <EmptyState title="You are not on a route">The school office assigns drivers and attendants to routes under Transport.</EmptyState>
      )}
    </>
  );
}
