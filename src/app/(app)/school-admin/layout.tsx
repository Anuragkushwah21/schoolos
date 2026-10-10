import { AppShell } from "@/components/shared/app-shell";
import { adminNav } from "@/lib/nav";
import { requireTenant } from "@/server/auth/current-user";
import { modulesAvailableToEnable } from "@/server/platform/entitlements";

/**
 * Chrome for this area. The guard here only decides whether to draw the shell;
 * layouts do not re-run on client navigation, so every page below repeats its
 * own check.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The Principal works in these screens too (only those its pages allow), with its own sidebar.
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  if (ctx.user.role === "PRINCIPAL") return <AppShell user={ctx.user}>{children}</AppShell>;
  // Waiting for the admin: staff and teacher leave, and student leave the
  // class teacher has approved (the final approval is the admin's).
  const [staffLeave, studentLeave, available] = await Promise.all([
    ctx.db.leaveRequest.count({ where: { status: "PENDING" } }),
    ctx.db.studentLeave.count({ where: { status: "TEACHER_APPROVED" } }),
    // Modules the plan includes that this campus has not switched on: a badge on My Schools.
    modulesAvailableToEnable(ctx.schoolId),
  ]);
  // My Schools is there for every School Admin: a campus request can be sent on any plan.
  return (
    <AppShell user={ctx.user} nav={adminNav({ leave: staffLeave + studentLeave, modulesToEnable: available.modules.length })}>
      {children}
    </AppShell>
  );
}
