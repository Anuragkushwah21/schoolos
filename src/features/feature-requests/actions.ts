"use server";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { featureCommentSchema, featureDecisionSchema, featureRequestSchema } from "@/lib/validation/feature-requests";
import { requireRoleForAction, requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";
import { commentOnMyFeatureRequest, decideFeatureRequest, submitFeatureRequest } from "@/server/platform/feature-requests";

type Result = ActionResult<undefined>;
const paths = ["/school-admin/feature-requests", "/super-admin/feature-requests"];

export async function submitFeatureRequestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    const row = await submitFeatureRequest(ctx, parseFormData(featureRequestSchema, formData));
    return successResult(`Request sent (${row.id.slice(-8).toUpperCase()}). SchoolOS will review it and agree cost and timeline with you before any work starts.`);
  }, { revalidate: paths });
}

export async function commentFeatureRequestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    const input = parseFormData(featureCommentSchema, formData);
    await commentOnMyFeatureRequest(ctx, input.requestId, input.body);
    return successResult("Reply sent to SchoolOS.");
  }, { revalidate: paths });
}

export async function decideFeatureRequestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const actor = await requireRoleForAction("SUPER_ADMIN");
    const { requestId, estimatedCostRupees, releaseScope, ...rest } = parseFormData(featureDecisionSchema, formData);
    await decideFeatureRequest(actor, requestId, { ...rest, releaseScope: releaseScope ?? null, estimatedCostMinor: estimatedCostRupees === undefined ? null : Math.round(estimatedCostRupees * 100) });
    return successResult("Saved.");
  }, { revalidate: paths });
}
