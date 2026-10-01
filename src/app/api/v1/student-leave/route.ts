import { z } from "zod";

import { STUDENT_LEAVE_STATUSES, studentLeaveSchema } from "@/lib/validation/student-leave";
import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { applyStudentLeave, listStudentLeaves } from "@/server/attendance/student-leave";

/**
 * Student leave requests the caller may see: all (School Admin), their class's
 * (class teacher), their children's (parent), their own (student).
 */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT"] }, async ({ request, ctx }) => {
  const filters = readQuery(request, z.object({ status: z.enum(STUDENT_LEAVE_STATUSES).optional(), q: z.string().max(60).optional(), studentId: z.string().max(40).optional() }));
  return apiSuccess(await listStudentLeaves(ctx, filters));
});

/** Apply: `{ studentId (parent), fromDate, toDate, reason, reasonText?, note? }`. A student applies for themselves. */
export const POST = apiRoute({ roles: ["PARENT", "STUDENT"] }, async ({ request, ctx }) => apiSuccess(await applyStudentLeave(ctx, await readJson(request, studentLeaveSchema)), { status: 201 }));
