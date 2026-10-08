import type { Metadata } from "next";

import { ApplicationScreen } from "@/features/admissions/screens/application-detail";
import { staffScope } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Application" };

export default async function StaffApplicationPage(props: PageProps<"/staff/admissions/[applicationId]">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "admissions.view");
  const { applicationId } = await props.params;
  return <ApplicationScreen ctx={ctx} applicationId={applicationId} scope={staffScope("/staff/admissions", await staffGrants(ctx), "admissions.manage")} />;
}
