import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { leaveRequestSchema } from "@/lib/validation/leave";
import { applyForLeave, listLeaveRequests, listMyLeave } from "@/server/staff/leave";

const query = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  teacherId: z.string().max(64).optional(),
  staffMemberId: z.string().max(64).optional(),
});

/** The caller's own requests, or — for the School Admin — every request in the school. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER", "NON_TEACHING_STAFF"] }, async ({ request, ctx }) => {
  if (ctx.user.role !== "SCHOOL_ADMIN") return apiSuccess(await listMyLeave(ctx));
  return apiSuccess(await listLeaveRequests(ctx, readQuery(request, query)));
});

/** Request leave: `{ type, startDate, endDate, reason }`. */
export const POST = apiRoute({ roles: ["TEACHER", "NON_TEACHING_STAFF"] }, async ({ request, ctx }) => {
  const input = await readJson(request, leaveRequestSchema);
  return apiSuccess(await applyForLeave(ctx, input), { status: 201 });
});
