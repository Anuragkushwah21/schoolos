import type { Metadata } from "next";

import { MyResponsibilitiesScreen } from "@/features/responsibilities/responsibilities-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "My responsibilities" };

export default async function TeacherResponsibilitiesPage() {
  const ctx = await requireTenant("TEACHER");
  return <MyResponsibilitiesScreen ctx={ctx} />;
}
