import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getChildRemarks } from "@/server/parent/child";

/** Structured observations about this child, from any of their teachers. */
export const GET = apiRoute<{ studentId: string }>({ roles: ["PARENT"] }, async ({ ctx, params }) => {
  const data = await getChildRemarks(ctx, params.studentId);
  return apiSuccess({ child: data.child, entries: data.entries });
});
