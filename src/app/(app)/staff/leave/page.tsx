import type { Metadata } from "next";

import { MyLeaveScreen } from "@/features/staff/my-leave";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Leave" };

export default async function StaffLeavePage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  return <MyLeaveScreen ctx={ctx} />;
}
