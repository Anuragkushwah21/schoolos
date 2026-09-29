import { AppShell } from "@/components/shared/app-shell";
import { staffNav } from "@/lib/nav";
import { requireUser } from "@/server/auth/current-user";
import { staffPermissions } from "@/server/auth/staff-access";
import { forSchool } from "@/server/tenancy/scope";

/**
 * Account settings and API tokens are shared by every role, and render inside
 * that role's own shell. The guard here only decides whether to draw the
 * shell; each page repeats its own check.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // A staff member's sidebar includes the modules they were granted.
  const nav =
    user.role === "NON_TEACHING_STAFF" && user.schoolId
      ? staffNav(await staffPermissions({ user, schoolId: user.schoolId, schoolSlug: user.schoolSlug ?? "", schoolName: user.schoolName ?? "", db: forSchool(user.schoolId) }))
      : undefined;
  return (
    <AppShell user={user} nav={nav}>
      {children}
    </AppShell>
  );
}
