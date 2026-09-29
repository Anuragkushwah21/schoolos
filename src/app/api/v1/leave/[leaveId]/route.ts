import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getLeaveRequest } from "@/server/staff/leave";

type Params = { leaveId: string };

/** One request with the periods it takes the teacher out of. School Admin. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) =>
  apiSuccess(await getLeaveRequest(ctx, params.leaveId)),
);
