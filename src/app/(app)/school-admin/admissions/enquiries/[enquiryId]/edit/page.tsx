import type { Metadata } from "next";

import { EditEnquiryScreen } from "@/features/admissions/screens/enquiry-edit";
import { ADMIN_ENQUIRY_SCOPE } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Edit enquiry" };

export default async function EditEnquiryPage(props: PageProps<"/school-admin/admissions/enquiries/[enquiryId]/edit">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { enquiryId } = await props.params;
  return <EditEnquiryScreen ctx={ctx} enquiryId={enquiryId} scope={ADMIN_ENQUIRY_SCOPE} />;
}
