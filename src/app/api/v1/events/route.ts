import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { eventSchema } from "@/lib/validation/communication";
import { getEvent, listEventsForAdmin, saveEvent } from "@/server/communication/events";

export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx }) =>
  apiSuccess(await listEventsForAdmin(ctx)),
);

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, eventSchema, { eventId: undefined });
  const id = await saveEvent(ctx, input);
  return apiSuccess(await getEvent(ctx, id), { status: 201 });
});
