import { apiRoute, apiSuccess } from "@/server/api/handler";
import { cancelStudentLeave } from "@/server/attendance/student-leave";

/** The requester withdraws a pending request (or an approved one not yet started). */
export const POST = apiRoute<{ leaveId: string }>({ roles: ["PARENT", "STUDENT"] }, async ({ ctx, params }) => {
  await cancelStudentLeave(ctx, params.leaveId);
  return apiSuccess({ ok: true });
});
