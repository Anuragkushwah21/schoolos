import { apiRoute, apiSuccess } from "@/server/api/handler";
import { deleteMedia } from "@/server/website/admin";

export const DELETE = apiRoute<{ mediaId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ ctx, params }) => {
    await deleteMedia(ctx, params.mediaId);
    return apiSuccess({ deleted: true });
  },
);
