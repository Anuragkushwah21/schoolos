import { AppShell } from "@/components/shared/app-shell";
import { requireRole } from "@/server/auth/current-user";

/**
 * The Principal's area. The guard here only decides whether to draw the
 * shell; every page repeats its own check.
 */
export default async function PrincipalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("PRINCIPAL");
  return <AppShell user={user}>{children}</AppShell>;
}
