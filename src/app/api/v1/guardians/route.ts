import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { guardiansQuery } from "@/lib/validation/api";
import { searchParents } from "@/server/people/students";

/** Guardians of the caller's school, for linking siblings to one record. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { q } = readQuery(request, guardiansQuery);
  return apiSuccess(await searchParents(ctx, q));
});
