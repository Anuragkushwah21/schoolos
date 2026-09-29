import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { leaveDecisionSchema } from "@/lib/validation/leave";
import { decideLeave } from "@/server/staff/leave";

/** Approve or reject pending requests: `{ leaveIds, decision, note? }`. A note is required to reject. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, leaveDecisionSchema);
  return apiSuccess(await decideLeave(ctx, input));
});
