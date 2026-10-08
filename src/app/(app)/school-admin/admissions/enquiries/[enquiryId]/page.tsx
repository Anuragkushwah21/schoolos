import type { Metadata } from "next";

import { EnquiryScreen } from "@/features/admissions/screens/enquiry-detail";
import { ADMIN_ENQUIRY_SCOPE } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Enquiry" };

export default async function EnquiryPage(props: PageProps<"/school-admin/admissions/enquiries/[enquiryId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { enquiryId } = await props.params;
  return <EnquiryScreen ctx={ctx} enquiryId={enquiryId} scope={ADMIN_ENQUIRY_SCOPE} />;
}
