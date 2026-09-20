import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { eventSchema } from "@/lib/validation/communication";
import { deleteEvent, getEvent, saveEvent } from "@/server/communication/events";

type Params = { eventId: string };

export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) =>
  apiSuccess(await getEvent(ctx, params.eventId)),
);

export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const input = await readJson(request, eventSchema, { eventId: params.eventId });
  await saveEvent(ctx, input);
  return apiSuccess(await getEvent(ctx, params.eventId));
});

export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteEvent(ctx, params.eventId);
  return apiSuccess({ deleted: true });
});
