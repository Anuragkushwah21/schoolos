import type { Metadata } from "next";

import { EnquiriesScreen } from "@/features/admissions/screens/enquiries-list";
import { staffScope } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Enquiries" };

/** Walk-in, phone and referral enquiries for front-desk staff — the School Admin's screen, within their permissions. */
export default async function StaffEnquiriesPage(props: PageProps<"/staff/enquiries">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "enquiries.view");
  return <EnquiriesScreen ctx={ctx} search={await props.searchParams} scope={staffScope("/staff/enquiries", await staffGrants(ctx), "enquiries.manage")} />;
}
