import { AppShell } from "@/components/shared/app-shell";
import { requireUser } from "@/server/auth/current-user";

/**
 * Account settings and API tokens are shared by every role, and render inside
 * that role's own shell. The guard here only decides whether to draw the
 * shell; each page repeats its own check.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
