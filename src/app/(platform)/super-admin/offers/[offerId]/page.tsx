import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { OfferForm } from "@/features/platform/forms";
import { toDateInput } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { getOffer } from "@/server/platform/offers";

export const metadata: Metadata = { title: "Edit offer" };

export default async function EditOfferPage(props: PageProps<"/super-admin/offers/[offerId]">) {
  const user = await requireSuperAdmin();
  const { offerId } = await props.params;
  const offer = await getOffer(user, offerId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  return (
    <>
      <PageHeader back={{ href: "/super-admin/offers", label: "Offers" }} title={offer.title} />
      <OfferForm
        offer={{
          id: offer.id,
          title: offer.title,
          description: offer.description,
          priceLabel: offer.priceLabel,
          ctaLabel: offer.ctaLabel,
          ctaHref: offer.ctaHref,
          startsAt: toDateInput(offer.startsAt),
          endsAt: offer.endsAt ? toDateInput(offer.endsAt) : null,
          sortOrder: offer.sortOrder,
          isActive: offer.isActive,
        }}
      />
    </>
  );
}
