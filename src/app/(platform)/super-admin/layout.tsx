import { AppShell } from "@/components/shared/app-shell";
import { superAdminNav } from "@/lib/nav";
import { requireRole } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

/**
 * Chrome for this area. The guard here only decides whether to draw the shell;
 * layouts do not re-run on client navigation, so every page below repeats its
 * own check.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("SUPER_ADMIN");
  // Schools waiting for a decision, as a badge on Approvals.
  const [pending, campusRequests, planRequests] = await Promise.all([
    prisma.school.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.campusRequest.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.planChangeRequest.count({ where: { status: "PENDING" } }),
  ]);
  return (
    <AppShell user={user} nav={superAdminNav({ pending, campusRequests, planRequests })}>
      {children}
    </AppShell>
  );
}
