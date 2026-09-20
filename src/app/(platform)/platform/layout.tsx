import { AppShell } from "@/components/shared/app-shell";
import { requireRole } from "@/server/auth/current-user";

/**
 * Chrome for this area. The guard here only decides whether to draw the shell;
 * layouts do not re-run on client navigation, so every page below repeats its
 * own check.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("SUPER_ADMIN");
  return <AppShell user={user}>{children}</AppShell>;
}
