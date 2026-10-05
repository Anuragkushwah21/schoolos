import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { tripMarkSchema } from "@/lib/validation/staff-roles";
import { markTrip } from "@/server/transport/driver";

/** Mark a student's pickup or drop today: `{ routeId, studentId, trip: "PICKUP"|"DROP", status, note }`. My routes only. */
export const POST = apiRoute({ roles: ["NON_TEACHING_STAFF"] }, async ({ request, ctx }) => {
  await markTrip(ctx, await readJson(request, tripMarkSchema));
  return apiSuccess({ marked: true });
});
