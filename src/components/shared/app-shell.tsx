import { ShellChrome } from "@/components/shared/shell-chrome";
import { NAV_BY_ROLE, type NavItem } from "@/lib/nav";
import { roleProfilePath } from "@/lib/roles";
import type { SessionUser } from "@/server/auth/session";
import { getT } from "@/server/i18n";
import { selfPhotoUrl } from "@/server/people/photos";

/**
 * Chrome shared by every signed-in area: a slim sidebar of what people do,
 * the school's name, the person, and switches for theme and language.
 *
 * Showing the school name at all times is a safety feature as much as a
 * convenience — an administrator who works with more than one school should
 * never be in doubt about whose data is on screen.
 *
 * The shell is rendered by each area's layout. Layouts do not re-run on
 * client-side navigation between sibling pages, so they are never the
 * authorization boundary: every page repeats its own guard.
 */
export async function AppShell({
  user,
  nav,
  children,
}: {
  user: SessionUser;
  /** Overrides the role's links — for staff, whose sidebar depends on what they have been granted. */
  nav?: NavItem[];
  children: React.ReactNode;
}) {
  const [t, photoUrl] = await Promise.all([getT(), selfPhotoUrl(user).catch(() => null)]);

  return (
    <ShellChrome
      nav={nav ?? NAV_BY_ROLE[user.role]}
      schoolName={user.schoolName ?? t("nav.platform")}
      user={{
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        role: user.role,
        profileHref: roleProfilePath(user.role),
        photoUrl,
      }}
    >
      {children}
    </ShellChrome>
  );
}
