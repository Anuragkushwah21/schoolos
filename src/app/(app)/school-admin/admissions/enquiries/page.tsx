import type { Metadata } from "next";

import { EnquiriesScreen } from "@/features/admissions/screens/enquiries-list";
import { ADMIN_ENQUIRY_SCOPE } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Walk-in admissions" };

export default async function EnquiriesPage(props: PageProps<"/school-admin/admissions/enquiries">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  return <EnquiriesScreen ctx={ctx} search={await props.searchParams} scope={ADMIN_ENQUIRY_SCOPE} />;
}
