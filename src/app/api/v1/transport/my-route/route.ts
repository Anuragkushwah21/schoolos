import { apiRoute, apiSuccess } from "@/server/api/handler";
import { myAssignedRoutes } from "@/server/transport/driver";

/** The signed-in driver's or attendant's routes today (own, or covered as a substitute): stops in order with rider counts. Needs "My route & stops". */
export const GET = apiRoute({ roles: ["NON_TEACHING_STAFF"] }, async ({ ctx }) => apiSuccess(await myAssignedRoutes(ctx)));
