import { CalendarCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { ChildChooser } from "@/features/parent/child-chooser";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Attendance" };

export default async function ParentAttendancePage() {
  const ctx = await requireTenant("PARENT");
  return <ChildChooser ctx={ctx} section="attendance" title="Attendance" description="Choose a child to see their attendance." icon={CalendarCheckIcon} tone="green" />;
}
