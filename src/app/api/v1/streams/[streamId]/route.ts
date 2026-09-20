import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { activeBody } from "@/lib/validation/api";
import { setStreamActive } from "@/server/academics/structure";

export const PATCH = apiRoute<{ streamId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const { isActive } = await readJson(request, activeBody);
    await setStreamActive(ctx, params.streamId, isActive);
    return apiSuccess({ id: params.streamId, isActive });
  },
);
