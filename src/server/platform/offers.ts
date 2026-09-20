import "server-only";

import { NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

/** Promotional offers shown on the marketing homepage. */

export type OfferInput = {
  title: string;
  description: string | null;
  priceLabel: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  startsAt: Date;
  endsAt: Date | null;
  sortOrder: number | null;
  isActive: boolean;
};

export async function listOffers(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.platformOffer.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { startsAt: "desc" }],
  });
}

export async function getOffer(actor: SessionUser, offerId: string) {
  assertRole(actor, "SUPER_ADMIN");
  const offer = await prisma.platformOffer.findUnique({ where: { id: offerId } });
  if (!offer) throw new NotFoundError();
  return offer;
}

export async function saveOffer(
  actor: SessionUser,
  offerId: string | null,
  input: OfferInput,
): Promise<string> {
  assertRole(actor, "SUPER_ADMIN");
  const data = { ...input, sortOrder: input.sortOrder ?? 0 };

  if (offerId) {
    await getOffer(actor, offerId);
    await prisma.platformOffer.update({ where: { id: offerId }, data });
    await recordAudit({
      action: "OFFER_UPDATED",
      entityType: "PlatformOffer",
      entityId: offerId,
      actorId: actor.id,
      summary: `Offer "${input.title}" updated.`,
    });
    return offerId;
  }

  const created = await prisma.platformOffer.create({ data, select: { id: true } });
  await recordAudit({
    action: "OFFER_CREATED",
    entityType: "PlatformOffer",
    entityId: created.id,
    actorId: actor.id,
    summary: `Offer "${input.title}" created.`,
  });
  return created.id;
}

export async function deleteOffer(actor: SessionUser, offerId: string): Promise<void> {
  const offer = await getOffer(actor, offerId);
  await prisma.platformOffer.delete({ where: { id: offer.id } });
  await recordAudit({
    action: "OFFER_DELETED",
    entityType: "PlatformOffer",
    entityId: offer.id,
    actorId: actor.id,
    summary: `Offer "${offer.title}" deleted.`,
  });
}
