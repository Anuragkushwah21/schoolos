import type { Metadata } from "next";

import { EnquiryScreen } from "@/features/admissions/screens/enquiry-detail";
import { staffScope } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Enquiry" };

/** One enquiry for front-desk staff: follow up and move it along; admitting a child stays with the School Admin. */
export default async function StaffEnquiryPage(props: PageProps<"/staff/enquiries/[enquiryId]">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "enquiries.view");
  const { enquiryId } = await props.params;
  return <EnquiryScreen ctx={ctx} enquiryId={enquiryId} scope={staffScope("/staff/enquiries", await staffGrants(ctx), "enquiries.manage")} />;
}
