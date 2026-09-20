import { apiRoute, apiSuccess } from "@/server/api/handler";
import { deleteSlot } from "@/server/timetable/service";

export const DELETE = apiRoute<{ slotId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ ctx, params }) => {
    await deleteSlot(ctx, params.slotId);
    return apiSuccess({ deleted: true });
  },
);
