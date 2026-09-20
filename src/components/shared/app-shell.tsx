import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import { NavLinks } from "@/components/shared/nav-links";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/features/auth/actions";
import { NAV_BY_ROLE } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/roles";
import type { SessionUser } from "@/server/auth/session";

/**
 * Chrome shared by every signed-in area: a sidebar of section links and a
 * header identifying who is signed in, to which school, and in what role.
 *
 * Showing the school name at all times is a safety feature as much as a
 * convenience — an administrator who works with more than one school should
 * never be in doubt about whose data is on screen.
 *
 * The shell is rendered by each area's layout. Layouts do not re-run on
 * client-side navigation between sibling pages, so they are never the
 * authorization boundary: every page repeats its own guard.
 */
export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border shrink-0 border-b md:sticky md:top-0 md:h-dvh md:w-60 md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex h-14 items-center px-5">
          <Link href="/" aria-label="SchoolOS home">
            <Logo />
          </Link>
        </div>

        <NavLinks items={NAV_BY_ROLE[user.role]} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {user.schoolName ?? "Platform administration"}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {user.firstName} {user.lastName} · {ROLE_LABEL[user.role]}
            </p>
          </div>

          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </header>

        <main className="min-w-0 flex-1 p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
