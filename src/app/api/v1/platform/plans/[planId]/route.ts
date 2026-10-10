import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { planDraftSchema } from "@/lib/validation/platform";
import { savePlanDraft } from "@/server/platform/plans";

/**
 * Save a plan's draft (rupees in, paise stored). Like the Plan Builder, this
 * never publishes: publishing is a separate, reviewed step in the UI.
 */
export const PUT = platformRoute<{ planId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ request, actor, params }) => {
    const { planId, priceRupees, extraCampusRupees, ...rest } = await readJson(request, planDraftSchema, { planId: params.planId });
    const { problems } = await savePlanDraft(actor.user, planId, {
      ...rest,
      priceMinor: Math.round((priceRupees ?? 0) * 100),
      extraCampusPriceMinor: extraCampusRupees === undefined ? null : Math.round(extraCampusRupees * 100),
    });
    return apiSuccess({ planId, draftSaved: true, problems });
  },
);
