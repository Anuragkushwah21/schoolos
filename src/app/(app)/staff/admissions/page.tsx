import type { Metadata } from "next";

import { ApplicationsScreen } from "@/features/admissions/screens/applications-list";
import { staffScope } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Applications" };

/** Online applications and where each stands, for front-desk staff. Converting to a student stays with the School Admin. */
export default async function StaffApplicationsPage(props: PageProps<"/staff/admissions">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "admissions.view");
  return <ApplicationsScreen ctx={ctx} search={await props.searchParams} scope={staffScope("/staff/admissions", await staffGrants(ctx), "admissions.manage")} />;
}
