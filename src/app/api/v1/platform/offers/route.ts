import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { offerSchema } from "@/lib/validation/platform";
import { getOffer, listOffers, saveOffer } from "@/server/platform/offers";

export const GET = platformRoute({ roles: ["SUPER_ADMIN"] }, async ({ actor }) =>
  apiSuccess(await listOffers(actor.user)),
);

/** Offers show on the homepage only between their dates, and only while active. */
export const POST = platformRoute({ roles: ["SUPER_ADMIN"] }, async ({ request, actor }) => {
  const { offerId, ...input } = await readJson(request, offerSchema, { offerId: undefined });
  const id = await saveOffer(actor.user, offerId ?? null, input);
  return apiSuccess(await getOffer(actor.user, id), { status: 201 });
});
