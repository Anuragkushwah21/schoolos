import type { Metadata } from "next";

import { NewEnquiryScreen } from "@/features/admissions/screens/enquiry-new";
import { staffScope } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "New enquiry" };

export default async function StaffNewEnquiryPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "enquiries.manage");
  return <NewEnquiryScreen ctx={ctx} scope={staffScope("/staff/enquiries", await staffGrants(ctx), "enquiries.manage")} />;
}
