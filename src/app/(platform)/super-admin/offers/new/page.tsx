import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { OfferForm } from "@/features/platform/forms";
import { requireSuperAdmin } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New offer" };

export default async function NewOfferPage() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader back={{ href: "/platform/offers", label: "Offers" }} title="New offer" />
      <OfferForm />
    </>
  );
}
