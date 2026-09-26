import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getParentAlerts } from "@/server/parent/alerts";

/**
 * What a guardian would want to be told without going looking.
 *
 * Derived on each read from the rows the school already wrote — there is no
 * notification table, so an alert cannot go stale or contradict its source.
 */
export const GET = apiRoute({ roles: ["PARENT"] }, async ({ ctx }) =>
  apiSuccess(await getParentAlerts(ctx)),
);
