import { z } from "zod";

import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { searchBorrowers } from "@/server/operations/library";

/**
 * `?q=` — students, teachers and staff a book can be issued to, with only
 * what the issue desk needs. School Admin, or staff who run the library.
 */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "NON_TEACHING_STAFF"] }, async ({ request, ctx }) => {
  const { q } = readQuery(request, z.object({ q: z.string().max(100).default("") }));
  return apiSuccess(await searchBorrowers(ctx, q));
});
