import type { Metadata } from "next";

import { VisitorsScreen } from "@/features/visitors/visitors-screen";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Visitors" };

/** The gate's visitor log, for staff the School Admin allowed. */
export default async function StaffVisitorsPage(props: PageProps<"/staff/visitors">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, ["visitors.view", "visitors.manage"]);
  const grants: string[] = await staffGrants(ctx);
  return <VisitorsScreen ctx={ctx} search={await props.searchParams} base="/staff/visitors" canManage={grants.includes("visitors.manage")} />;
}
