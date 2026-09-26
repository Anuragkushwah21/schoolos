import { redirect } from "next/navigation";

/**
 * `/student` is the area, `/student/dashboard` is the page.
 *
 * `ROLE_HOME` points at the dashboard, so nothing in the app links here. This
 * exists for bookmarks and typed URLs, which would otherwise 404 on the most
 * obvious address to guess.
 */
export default function StudentIndexPage() {
  redirect("/student/dashboard");
}
