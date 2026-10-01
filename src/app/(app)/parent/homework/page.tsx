import { NotebookPenIcon } from "lucide-react";
import type { Metadata } from "next";

import { ChildChooser } from "@/features/parent/child-chooser";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Homework" };

export default async function ParentHomeworkPage() {
  const ctx = await requireTenant("PARENT");
  return <ChildChooser ctx={ctx} section="homework" title="Homework" description="Choose a child to see their homework." icon={NotebookPenIcon} tone="purple" />;
}
