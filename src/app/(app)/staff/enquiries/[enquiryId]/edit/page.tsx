import type { Metadata } from "next";

import { EditEnquiryScreen } from "@/features/admissions/screens/enquiry-edit";
import { staffScope } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Edit enquiry" };

export default async function StaffEditEnquiryPage(props: PageProps<"/staff/enquiries/[enquiryId]/edit">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "enquiries.manage");
  const { enquiryId } = await props.params;
  return <EditEnquiryScreen ctx={ctx} enquiryId={enquiryId} scope={staffScope("/staff/enquiries", await staffGrants(ctx), "enquiries.manage")} />;
}
