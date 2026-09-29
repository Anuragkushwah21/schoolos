import { AppShell } from "@/components/shared/app-shell";
import { staffNav } from "@/lib/nav";
import { requireTenant } from "@/server/auth/current-user";
import { staffPermissions } from "@/server/auth/staff-access";

/**
 * Chrome for the non-teaching staff portal. The sidebar shows only the modules
 * this person has been granted — presentation, not protection: every page and
 * service below checks the role and the permission again.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  return (
    <AppShell user={ctx.user} nav={staffNav(await staffPermissions(ctx))}>
      {children}
    </AppShell>
  );
}
