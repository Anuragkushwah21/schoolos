import { redirect } from "next/navigation";

/**
 * `/teacher` is the area, `/teacher/dashboard` is the page.
 *
 * `ROLE_HOME` already points at the dashboard, so nothing in the app links
 * here. This exists for bookmarks and typed URLs, which would otherwise 404
 * on the most obvious address a teacher could guess.
 */
export default function TeacherIndexPage() {
  redirect("/teacher/dashboard");
}
