import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { routeSchema } from "@/lib/validation/operations";
import { listRoutes, saveRoute } from "@/server/operations/transport";

/** Routes with stops, vehicle, driver and rider counts. School Admin only. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx }) => apiSuccess(await listRoutes(ctx)));

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const id = await saveRoute(ctx, await readJson(request, routeSchema, { routeId: undefined }));
  return apiSuccess({ id }, { status: 201 });
});
