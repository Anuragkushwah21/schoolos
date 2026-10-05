import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { routeIssueSchema } from "@/lib/validation/staff-roles";
import { reportRouteIssue } from "@/server/transport/driver";

/** Report something wrong on one of my routes today: `{ routeId, note }`. */
export const POST = apiRoute({ roles: ["NON_TEACHING_STAFF"] }, async ({ request, ctx }) => {
  await reportRouteIssue(ctx, await readJson(request, routeIssueSchema));
  return apiSuccess({ reported: true }, { status: 201 });
});
