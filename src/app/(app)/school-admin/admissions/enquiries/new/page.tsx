import type { Metadata } from "next";

import { NewEnquiryScreen } from "@/features/admissions/screens/enquiry-new";
import { ADMIN_ENQUIRY_SCOPE } from "@/features/admissions/screens/scope";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New enquiry" };

/** A walk-in, phone call or referral: the parent once, then each child. */
export default async function NewEnquiryPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  return <NewEnquiryScreen ctx={ctx} scope={ADMIN_ENQUIRY_SCOPE} />;
}
