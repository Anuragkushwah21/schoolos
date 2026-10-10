import { ShellChrome } from "@/components/shared/shell-chrome";
import { DemoBanner } from "@/features/demo/forms";
import { demoPlanState, demoRoleOf } from "@/server/demo/sessions";
import { NAV_BY_ROLE, type NavItem } from "@/lib/nav";
import { roleProfilePath } from "@/lib/roles";
import type { SessionUser } from "@/server/auth/session";
import { getT } from "@/server/i18n";
import { selfPhotoUrl } from "@/server/people/photos";
import { withinModules } from "@/lib/school-modules";
import { switchableCampuses } from "@/server/platform/campuses";
import { schoolModules } from "@/server/platform/modules";

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
  const [t, photoUrl, modules, campuses] = await Promise.all([
    getT(),
    selfPhotoUrl(user).catch(() => null),
    // A school's sidebar shows only the modules its plan includes.
    user.schoolId ? schoolModules(user.schoolId) : Promise.resolve(null),
    // An Owner with more than one live campus gets the campus switcher.
    user.role === "SCHOOL_ADMIN" ? switchableCampuses(user).catch(() => []) : Promise.resolve([]),
  ]);
  const links = nav ?? NAV_BY_ROLE[user.role];

  const shell = (
    <ShellChrome
      nav={modules ? withinModules(links, modules) : links}
      modules={modules}
      schoolName={user.schoolName ?? t("nav.platform")}
      campuses={campuses.length > 1 ? campuses : undefined}
      currentSchoolId={user.schoolId}
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
  // The Live Demo: a bar on every page says so, with role switch, reset and exit.
  const demoRole = user.isDemo ? demoRoleOf(user) : null;
  if (!demoRole) return shell;
  const demoPlan = user.schoolId ? await demoPlanState(user.schoolId).catch(() => null) : null;
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <DemoBanner role={demoRole} expiresAt={user.demoExpiresAt ?? null} plans={demoPlan?.plans ?? []} currentPlan={demoPlan?.current ?? null} />
      {shell}
    </div>
  );
}
