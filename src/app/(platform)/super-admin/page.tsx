import { redirect } from "next/navigation";

/**
 * `/super-admin` is the area, `/super-admin/dashboard` is the page.
 *
 * `ROLE_HOME` already points at the dashboard, so nothing in the app links
 * here. This exists for bookmarks and typed URLs, which would otherwise 404
 * on the most obvious address to guess.
 */
export default function SuperAdminIndexPage() {
  redirect("/super-admin/dashboard");
}
