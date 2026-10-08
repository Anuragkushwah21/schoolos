import type { Metadata } from "next";

import { ApplicationsScreen } from "@/features/admissions/screens/applications-list";
import { ADMIN_APPLICATION_SCOPE } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Online admissions" };

export default async function AdmissionsPage(props: PageProps<"/school-admin/admissions">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  return <ApplicationsScreen ctx={ctx} search={await props.searchParams} scope={ADMIN_APPLICATION_SCOPE} />;
}
