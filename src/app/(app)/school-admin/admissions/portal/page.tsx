import { redirect } from "next/navigation";

/** The admission form's settings now live under Website. Old links land there. */
export default function AdmissionPortalPage() {
  redirect("/school-admin/website/admission");
}
