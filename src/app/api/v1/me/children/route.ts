import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getParentChildren } from "@/server/people/portal";

/** Exactly the children linked to the signed-in guardian. */
export const GET = apiRoute({ roles: ["PARENT"] }, async ({ ctx }) => {
  const { session, date, children } = await getParentChildren(ctx);
  return apiSuccess({ session, date, children });
});
