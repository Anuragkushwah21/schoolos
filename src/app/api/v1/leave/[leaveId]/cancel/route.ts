import { apiRoute, apiSuccess } from "@/server/api/handler";
import { cancelLeave } from "@/server/staff/leave";

type Params = { leaveId: string };

/** The teacher cancels their own pending leave, or approved leave not yet started. */
export const POST = apiRoute<Params>({ roles: ["TEACHER"] }, async ({ ctx, params }) => {
  await cancelLeave(ctx, params.leaveId);
  return apiSuccess({ status: "CANCELLED" });
});
