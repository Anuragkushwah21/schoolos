import { z } from "zod";

import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { myRouteRiders } from "@/server/transport/driver";

type Params = { routeId: string };

const query = z.object({ stopId: z.string().max(64).optional() });

/**
 * The students on one of my routes (or one stop), with today's pickup and
 * drop status. 403 for a route that is not mine. Guardian contact only with
 * "Emergency contact of my riders".
 */
export const GET = apiRoute<Params>({ roles: ["NON_TEACHING_STAFF"] }, async ({ request, ctx, params }) => {
  const { stopId } = readQuery(request, query);
  return apiSuccess(await myRouteRiders(ctx, params.routeId, { stopId }));
});
