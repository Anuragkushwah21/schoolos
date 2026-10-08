import type { Metadata } from "next";

import { ApplicationScreen } from "@/features/admissions/screens/application-detail";
import { ADMIN_APPLICATION_SCOPE } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Application" };

export default async function AdmissionPage(props: PageProps<"/school-admin/admissions/[applicationId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { applicationId } = await props.params;
  return <ApplicationScreen ctx={ctx} applicationId={applicationId} scope={ADMIN_APPLICATION_SCOPE} />;
}
