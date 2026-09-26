import { AccountMenu, AccountMenuMobile, type AccountMenuUser } from "@/features/auth/account-menu";
import { ROLE_LABEL, roleHomePath, roleProfilePath } from "@/lib/roles";
import { getCurrentUser } from "@/server/auth/current-user";

/**
 * The header's account corner, resolved on the server.
 *
 * `getCurrentUser` validates the session against the database on every request
 * — it is the same call the guards use — so the header cannot say "signed in"
 * for a cookie that has expired, been revoked, or belongs to a suspended
 * school. Nothing about auth state is kept in the browser.
 *
 * Because it renders on the server, it also updates on its own: signing in or
 * out navigates, the layout renders again, and the corner changes with it. No
 * refresh, and no second source of truth to keep in step.
 */
export async function SiteHeaderAccount({ mobile = false }: { mobile?: boolean }) {
  const user = await getCurrentUser();

  const menuUser: AccountMenuUser | null = user
    ? {
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        email: user.email,
        roleLabel: ROLE_LABEL[user.role],
        // Computed here from the session's own role, so the menu can only ever
        // offer the area this person is allowed into.
        dashboardHref: roleHomePath(user.role),
        profileHref: roleProfilePath(user.role),
      }
    : null;

  return mobile ? <AccountMenuMobile user={menuUser} /> : <AccountMenu user={menuUser} />;
}
