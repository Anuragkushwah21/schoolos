import { studentLeaveDecisionSchema } from "@/lib/validation/student-leave";
import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { decideStudentLeave } from "@/server/attendance/student-leave";

/** `{ decision: APPROVE|REJECT, comment? }` — the class teacher, or the School Admin. Attendance is never changed. */
export const POST = apiRoute<{ leaveId: string }>({ roles: ["TEACHER", "SCHOOL_ADMIN"] }, async ({ request, ctx, params }) =>
  apiSuccess(await decideStudentLeave(ctx, await readJson(request, studentLeaveDecisionSchema, { leaveId: params.leaveId }))),
);
