import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { planDraftSchema } from "@/lib/validation/platform";
import { savePlanDraft } from "@/server/platform/plans";

/**
 * Save a plan's draft (rupees in, paise stored). Like the Plan Builder, this
 * never publishes: publishing is a separate, reviewed step in the UI.
 *
 * Only the settings in the body change; everything else keeps its saved
 * value — sending `{ "name": "…" }` does not clear the plan's modules,
 * features, roles or price.
 */
const partialDraftSchema = planDraftSchema.partial().required({ planId: true });

export const PUT = platformRoute<{ planId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ request, actor, params }) => {
    const body: unknown = await request.clone().json().catch(() => null);
    const sent = new Set(body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : []);
    const { planId, priceRupees, extraCampusRupees, ...rest } = await readJson(request, partialDraftSchema, { planId: params.planId });
    const input: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([key]) => sent.has(key)));
    if (sent.has("priceRupees")) input.priceMinor = Math.round((priceRupees ?? 0) * 100);
    if (sent.has("extraCampusRupees")) input.extraCampusPriceMinor = extraCampusRupees === undefined ? null : Math.round(extraCampusRupees * 100);
    const { problems } = await savePlanDraft(actor.user, planId, input);
    return apiSuccess({ planId, draftSaved: true, problems });
  },
);
