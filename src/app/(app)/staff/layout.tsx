import { AppShell } from "@/components/shared/app-shell";
import { staffNav } from "@/lib/nav";
import { requireTenant } from "@/server/auth/current-user";
import { staffGrants } from "@/server/auth/staff-access";
import { hasAssignedRoute } from "@/server/transport/driver";

/**
 * Chrome for the non-teaching staff portal. The sidebar shows only the modules
 * this person has been granted — presentation, not protection: every page and
 * service below checks the role and the permission again.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const [grants, assignedRoute] = await Promise.all([staffGrants(ctx), hasAssignedRoute(ctx)]);
  return (
    <AppShell user={ctx.user} nav={staffNav(grants, { assignedRoute })}>
      {children}
    </AppShell>
  );
}
