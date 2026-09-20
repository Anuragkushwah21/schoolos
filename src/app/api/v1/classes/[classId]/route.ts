import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { activeBody } from "@/lib/validation/api";
import { setClassActive } from "@/server/academics/structure";

/** Start or stop offering a class. Past records keep referring to it. */
export const PATCH = apiRoute<{ classId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const { isActive } = await readJson(request, activeBody);
    await setClassActive(ctx, params.classId, isActive);
    return apiSuccess({ id: params.classId, isActive });
  },
);
