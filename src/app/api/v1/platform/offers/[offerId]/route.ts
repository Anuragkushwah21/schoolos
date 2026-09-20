import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { offerSchema } from "@/lib/validation/platform";
import { deleteOffer, getOffer, saveOffer } from "@/server/platform/offers";

type Params = { offerId: string };

export const GET = platformRoute<Params>({ roles: ["SUPER_ADMIN"] }, async ({ actor, params }) =>
  apiSuccess(await getOffer(actor.user, params.offerId)),
);

export const PUT = platformRoute<Params>(
  { roles: ["SUPER_ADMIN"] },
  async ({ request, actor, params }) => {
    const { offerId, ...input } = await readJson(request, offerSchema, { offerId: params.offerId });
    await saveOffer(actor.user, offerId ?? params.offerId, input);
    return apiSuccess(await getOffer(actor.user, params.offerId));
  },
);

export const DELETE = platformRoute<Params>({ roles: ["SUPER_ADMIN"] }, async ({ actor, params }) => {
  await deleteOffer(actor.user, params.offerId);
  return apiSuccess({ deleted: true });
});
