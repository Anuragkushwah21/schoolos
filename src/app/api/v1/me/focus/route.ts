import { apiRoute, apiError, apiSuccess, readQuery } from "@/server/api/handler";
import { childFocusQuery } from "@/lib/validation/api";
import { getChildFocus } from "@/server/parent/child";

/**
 * What to help one child with at home, derived only from school records.
 *
 * Deterministic: every item names the lesson, mark or due date it came from.
 * `?child=<studentId>` is required and is checked against the guardian link.
 */
export const GET = apiRoute({ roles: ["PARENT"] }, async ({ request, ctx }) => {
  const query = readQuery(request, childFocusQuery);
  if (!query.child) return apiError("VALIDATION", "Pass ?child=<studentId>.");
  return apiSuccess(await getChildFocus(ctx, query.child));
});
