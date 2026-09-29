import { z } from "zod";

import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { id } from "@/lib/validation/common";
import { changeSection } from "@/server/people/bulk-students";

/** Move students to another section of the same session: `{ toSectionId, studentIds }`. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, z.object({ toSectionId: id, studentIds: z.array(id).min(1).max(1000) }));
  return apiSuccess(await changeSection(ctx, input));
});
