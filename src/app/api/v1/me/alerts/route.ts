import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getStaffAlerts, getStudentAlerts, getTeacherAlerts } from "@/server/alerts/feeds";
import { getParentAlerts } from "@/server/parent/alerts";

/**
 * What the signed-in parent, student, teacher or staff member would want to be told.
 *
 * Derived on each read from the rows the school already wrote — there is no
 * notification table, so an alert cannot go stale or contradict its source.
 */
export const GET = apiRoute({ roles: ["PARENT", "STUDENT", "TEACHER", "NON_TEACHING_STAFF"] }, async ({ ctx }) => {
  if (ctx.user.role === "STUDENT") return apiSuccess(await getStudentAlerts(ctx));
  if (ctx.user.role === "TEACHER") return apiSuccess(await getTeacherAlerts(ctx));
  if (ctx.user.role === "NON_TEACHING_STAFF") return apiSuccess(await getStaffAlerts(ctx));
  return apiSuccess(await getParentAlerts(ctx));
});
