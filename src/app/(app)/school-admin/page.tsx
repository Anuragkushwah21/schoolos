import { redirect } from "next/navigation";

/**
 * `/school-admin` is the area, `/school-admin/dashboard` is the page.
 *
 * `ROLE_HOME` already points at the dashboard, so nothing in the app links
 * here. This exists for bookmarks and typed URLs, which would otherwise 404
 * on the most obvious address to guess.
 */
export default function SchoolAdminIndexPage() {
  redirect("/school-admin/dashboard");
}
