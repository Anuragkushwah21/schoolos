import { redirect } from "next/navigation";

/** The office's "Add enquiry" is now a family enquiry. Old links land there. */
export default function NewAdmissionPage() {
  redirect("/school-admin/admissions/enquiries/new");
}
