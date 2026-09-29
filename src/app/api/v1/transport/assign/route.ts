import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { assignTransportSchema } from "@/lib/validation/operations";
import { assignTransport } from "@/server/operations/transport";

/** Put students on a route: `{ routeId, stopId?, studentIds, startDate }`. Capacity is checked. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) =>
  apiSuccess(await assignTransport(ctx, await readJson(request, assignTransportSchema))),
);
