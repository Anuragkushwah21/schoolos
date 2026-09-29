import { redirect } from "next/navigation";

/** `/staff` is the area, `/staff/dashboard` is the page — as for teachers. */
export default function StaffIndexPage() {
  redirect("/staff/dashboard");
}
