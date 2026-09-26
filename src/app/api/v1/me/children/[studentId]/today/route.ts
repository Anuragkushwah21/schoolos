import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getChildToday } from "@/server/parent/child";

/**
 * One child's day: the register, each period as the teacher wrote it up, what
 * is due, the latest mark and the latest remark.
 *
 * `getChildToday` re-resolves the guardian link itself, so editing the id in
 * the path reaches another family's child no more than a made-up id does.
 */
export const GET = apiRoute<{ studentId: string }>({ roles: ["PARENT"] }, async ({ ctx, params }) => {
  const data = await getChildToday(ctx, params.studentId);
  return apiSuccess({
    child: data.child,
    date: data.date,
    attendance: data.attendance,
    periods: data.periods,
    tally: data.tally,
    homework: data.homework,
    latestResult: data.latestResult,
    latestRemark: data.latestRemark,
  });
});
