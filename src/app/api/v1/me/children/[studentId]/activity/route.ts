import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { childActivityQuery } from "@/lib/validation/api";
import { getChildActivity } from "@/server/parent/child";

/** What was actually taught in this child's class, newest first. */
export const GET = apiRoute<{ studentId: string }>({ roles: ["PARENT"] }, async ({ request, ctx, params }) => {
  const query = readQuery(request, childActivityQuery);
  const data = await getChildActivity(ctx, params.studentId, {
    days: query.days,
    subjectId: query.subject ?? null,
  });
  return apiSuccess({ child: data.child, subjects: data.subjects, entries: data.entries });
});
