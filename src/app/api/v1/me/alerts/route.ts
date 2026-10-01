import { z } from "zod";

import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { markAlertsRead, notificationCenter } from "@/server/alerts/center";

const ROLES = ["SCHOOL_ADMIN", "PARENT", "STUDENT", "TEACHER", "NON_TEACHING_STAFF"] as const;

/**
 * What the signed-in person would want to be told, each with `key` and `read`.
 *
 * Derived on each read from the rows the school already wrote — there is no
 * notification table, so an alert cannot go stale or contradict its source.
 * Only what this person has read is stored, on their own account.
 */
export const GET = apiRoute({ roles: [...ROLES] }, async ({ ctx }) => {
  const { alerts } = await notificationCenter(ctx);
  return apiSuccess(alerts);
});

const readBody = z.object({ keys: z.array(z.string().max(80)).max(100).optional(), all: z.boolean().optional() });

/** Mark alerts read: `{ keys: [...] }` or `{ all: true }`. */
export const POST = apiRoute({ roles: [...ROLES] }, async ({ request, ctx }) => {
  await markAlertsRead(ctx, await readJson(request, readBody));
  return apiSuccess({ ok: true });
});
