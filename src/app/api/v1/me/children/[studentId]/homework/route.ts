import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getChildHomework } from "@/server/parent/child";

/**
 * Published work set for this child's section, bucketed by urgency.
 *
 * Read-only: nothing in `src/server/parent/` writes, and the homework writers
 * assert TEACHER, so a guardian cannot change what a teacher set.
 */
export const GET = apiRoute<{ studentId: string }>({ roles: ["PARENT"] }, async ({ ctx, params }) => {
  const data = await getChildHomework(ctx, params.studentId);
  return apiSuccess({
    child: data.child,
    overdue: data.overdue,
    dueToday: data.dueToday,
    dueSoon: data.dueSoon,
    upcoming: data.upcoming,
    past: data.past,
  });
});
