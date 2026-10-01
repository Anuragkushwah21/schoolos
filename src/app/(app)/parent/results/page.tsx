import { GraduationCapIcon } from "lucide-react";
import type { Metadata } from "next";

import { ChildChooser } from "@/features/parent/child-chooser";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Results" };

export default async function ParentResultsPage() {
  const ctx = await requireTenant("PARENT");
  return <ChildChooser ctx={ctx} section="results" title="Results" description="Choose a child to see their results." icon={GraduationCapIcon} tone="orange" />;
}
