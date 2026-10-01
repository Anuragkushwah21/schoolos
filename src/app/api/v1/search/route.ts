import { z } from "zod";

import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { searchSchool } from "@/server/search/service";

/**
 * `?q=` across the school's people and classes. What comes back depends on
 * the caller's role and assignments, worked out on the server.
 */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER", "NON_TEACHING_STAFF"] }, async ({ request, ctx }) => {
  const { q } = readQuery(request, z.object({ q: z.string().max(100).default("") }));
  return apiSuccess(await searchSchool(ctx, q));
});
