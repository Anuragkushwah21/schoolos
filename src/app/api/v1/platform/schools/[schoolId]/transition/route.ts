import { z } from "zod";

import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { optionalText } from "@/lib/validation/common";
import { getSchoolForPlatform, transitionSchool } from "@/server/platform/schools";

const body = z.object({
  transition: z.enum(["review", "approve", "reject", "suspend", "reactivate"]),
  reason: optionalText(500),
});

/**
 * Move a school through its lifecycle.
 *
 * Approving also provisions the school and issues its first administrator,
 * whose one-time password comes back in the response. Suspending signs
 * everyone at the school out immediately. Rejecting and suspending need a
 * reason, which the school is told.
 */
export const POST = platformRoute<{ schoolId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ request, actor, params }) => {
    const { transition, reason } = await readJson(request, body);
    const { credentials } = await transitionSchool(actor.user, params.schoolId, transition, reason);
    const { school } = await getSchoolForPlatform(actor.user, params.schoolId);
    return apiSuccess({ school, credentials: credentials ?? null });
  },
);
