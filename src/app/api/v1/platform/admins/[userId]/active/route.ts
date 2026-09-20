import { z } from "zod";

import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { setSchoolAdminActive } from "@/server/platform/schools";

/** Deactivating signs the administrator out at once. */
export const POST = platformRoute<{ userId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ request, actor, params }) => {
    const { isActive } = await readJson(request, z.object({ isActive: z.boolean() }));
    await setSchoolAdminActive(actor.user, params.userId, isActive);
    return apiSuccess({ userId: params.userId, isActive });
  },
);
