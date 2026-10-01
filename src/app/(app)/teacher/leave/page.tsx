import type { Metadata } from "next";

import { MyLeaveScreen } from "@/features/staff/my-leave";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Leave" };

export default async function TeacherLeavePage() {
  const ctx = await requireTenant("TEACHER");
  return <MyLeaveScreen ctx={ctx} />;
}
