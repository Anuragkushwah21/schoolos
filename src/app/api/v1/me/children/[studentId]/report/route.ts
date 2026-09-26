import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { childReportQuery } from "@/lib/validation/api";
import { getChildReport } from "@/server/parent/child";

/**
 * A summary assembled from source data — no separate report document exists.
 *
 * `?period=day|week|month`, defaulting to the week.
 */
export const GET = apiRoute<{ studentId: string }>({ roles: ["PARENT"] }, async ({ request, ctx, params }) => {
  const query = readQuery(request, childReportQuery);
  return apiSuccess(await getChildReport(ctx, params.studentId, query.period ?? "week"));
});
