import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { planSchema } from "@/lib/validation/platform";
import { listPlans, updatePlan } from "@/server/platform/plans";

/** Prices are entered in rupees and stored in paise, as integers. */
export const PUT = platformRoute<{ planId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ request, actor, params }) => {
    const { planId, priceRupees, ...rest } = await readJson(request, planSchema, {
      planId: params.planId,
    });
    await updatePlan(actor.user, planId, { ...rest, priceMinor: Math.round(priceRupees * 100) });
    const plans = await listPlans(actor.user);
    return apiSuccess(plans.find((plan) => plan.id === planId) ?? null);
  },
);
