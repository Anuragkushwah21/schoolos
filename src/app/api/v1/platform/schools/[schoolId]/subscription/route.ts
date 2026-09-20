import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { subscriptionSchema } from "@/lib/validation/platform";
import { getSchoolForPlatform, setSubscription } from "@/server/platform/schools";

/** Record what a school is entitled to. Payment is out of V1; this is the ledger. */
export const PUT = platformRoute<{ schoolId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ request, actor, params }) => {
    const input = await readJson(request, subscriptionSchema, { schoolId: params.schoolId });
    await setSubscription(actor.user, input);
    const { school } = await getSchoolForPlatform(actor.user, params.schoolId);
    return apiSuccess(school.subscriptions[0] ?? null);
  },
);
