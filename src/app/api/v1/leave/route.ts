import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { leaveRequestSchema } from "@/lib/validation/leave";
import { applyForLeave, listLeaveRequests, listMyLeave } from "@/server/staff/leave";

const query = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional() });

/** A teacher's own requests, or — for the School Admin — every request in the school. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  if (ctx.user.role === "TEACHER") return apiSuccess(await listMyLeave(ctx));
  const { status } = readQuery(request, query);
  return apiSuccess(await listLeaveRequests(ctx, { status }));
});

/** Request leave: `{ type, startDate, endDate, reason }`. */
export const POST = apiRoute({ roles: ["TEACHER"] }, async ({ request, ctx }) => {
  const input = await readJson(request, leaveRequestSchema);
  return apiSuccess(await applyForLeave(ctx, input), { status: 201 });
});
