import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { slotUpdateSchema } from "@/lib/validation/timetable";
import { deleteSlot, getSlot, updateSlot } from "@/server/timetable/service";

type Params = { slotId: string };

/**
 * Edit a period of this session's timetable (`roomId` null for no room).
 * Once lessons are recorded against it, only the room can change.
 */
export const PATCH = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  await updateSlot(ctx, await readJson(request, slotUpdateSchema, { slotId: params.slotId }));
  return apiSuccess(await getSlot(ctx, params.slotId));
});

export const DELETE = apiRoute<Params>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ ctx, params }) => {
    await deleteSlot(ctx, params.slotId);
    return apiSuccess({ deleted: true });
  },
);
