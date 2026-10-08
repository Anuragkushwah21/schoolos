import { apiRoute, apiSuccess } from "@/server/api/handler";
import { childTransportToday } from "@/server/transport/parent-status";

/**
 * Today's transport for one of the parent's own children: route, stop,
 * pickup and drop status with the time marked, and today's crew. The
 * guardian link is checked in the database; another family's child is 404.
 * `null` when the child does not use school transport.
 */
export const GET = apiRoute<{ studentId: string }>({ roles: ["PARENT"] }, async ({ ctx, params }) => {
  return apiSuccess(await childTransportToday(ctx, params.studentId));
});
