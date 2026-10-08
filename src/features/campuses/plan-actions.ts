"use server";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { planApproveSchema, planRejectSchema, planRequestIdSchema, planRequestSchema } from "@/lib/validation/campuses";
import { requireRoleForAction, requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";
import { approvePlanChange, cancelPlanChange, rejectPlanChange, requestPlanChange } from "@/server/platform/plan-requests";

type Result = ActionResult<undefined>;
const paths = ["/school-admin/plan", "/school-admin/campuses", "/super-admin/plan-requests", "/super-admin/schools"];

/** Ask for another plan. Nothing changes until SchoolOS approves. */
export async function requestPlanChangeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    await requestPlanChange(ctx, parseFormData(planRequestSchema, formData));
    return successResult("Request sent. SchoolOS will confirm the upgrade; your plan stays the same until then.");
  }, { revalidate: paths });
}

export async function cancelPlanChangeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    await cancelPlanChange(ctx, parseFormData(planRequestIdSchema, formData).requestId);
    return successResult("Plan request withdrawn.");
  }, { revalidate: paths });
}

export async function approvePlanChangeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const input = parseFormData(planApproveSchema, formData);
    await approvePlanChange(await requireRoleForAction("SUPER_ADMIN"), input.requestId, input.reviewNote);
    return successResult("Approved. The school is now on the new plan.");
  }, { revalidate: paths });
}

export async function rejectPlanChangeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const input = parseFormData(planRejectSchema, formData);
    await rejectPlanChange(await requireRoleForAction("SUPER_ADMIN"), input.requestId, input.reason);
    return successResult("Plan request rejected.");
  }, { revalidate: paths });
}
