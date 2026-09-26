import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getChildResults } from "@/server/parent/child";

/**
 * Every assessment this child's class has sat, with their own mark.
 *
 * Percentages are computed from the mark and the paper's total rather than
 * stored, and a null mark means the child did not sit it — not zero.
 */
export const GET = apiRoute<{ studentId: string }>({ roles: ["PARENT"] }, async ({ ctx, params }) => {
  const data = await getChildResults(ctx, params.studentId);
  return apiSuccess({
    child: data.child,
    entries: data.entries,
    subjects: data.subjects,
    overall: data.overall,
    satCount: data.satCount,
  });
});
