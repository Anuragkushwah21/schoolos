"use server";

import type { Route } from "next";
import { cookies } from "next/headers";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { limitsFromForm } from "@/lib/school-roles";
import { campusApproveSchema, campusRequestEditSchema, campusLimitSchema, campusRejectSchema, campusRequestSchema, campusReviewSchema, campusSwitchSchema } from "@/lib/validation/campuses";
import { UnauthenticatedError } from "@/lib/errors";
import { requireRoleForAction, requireTenantForAction } from "@/server/auth/current-user";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { approveCampusRequest, markCampusRequestUnderReview, rejectCampusRequest, submitCampusRequest, updateCampusRequest } from "@/server/campuses/requests";
import { setCampusLimitOverride, switchCampus } from "@/server/platform/campuses";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/** Switch the Owner's session to another of their campuses — checked on the server, never trusted from the form. */
export async function switchCampusAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const user = await requireRoleForAction("SCHOOL_ADMIN");
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!token) throw new UnauthenticatedError();
    const { schoolId } = parseFormData(campusSwitchSchema, formData);
    const { name } = await switchCampus(user, token, schoolId);
    return successResult(`Now working in ${name}.`);
  }, { revalidate: "/" });
}

export async function submitCampusRequestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    const input = parseFormData(campusRequestSchema, formData);
    await submitCampusRequest(ctx, input, limitsFromForm(formData));
    return successResult(`Request for ${input.name} sent to SchoolOS for review.`);
  }, { revalidate: ["/school-admin/campuses", "/super-admin/campus-requests"], redirectTo: "/school-admin/campuses/requests" as Route });
}

/** Correct a request that is still pending. Refused once SchoolOS has taken it up. */
export async function updateCampusRequestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    const { requestId, ...input } = parseFormData(campusRequestEditSchema, formData);
    await updateCampusRequest(ctx, requestId, input, limitsFromForm(formData));
    return successResult("Request updated.");
  }, { revalidate: ["/school-admin/campuses", "/super-admin/campus-requests"], redirectTo: "/school-admin/campuses/requests" as Route });
}

// --- Super Admin ------------------------------------------------------------

const superAdmin = () => requireRoleForAction("SUPER_ADMIN");
const platform = ["/super-admin/campus-requests", "/super-admin/schools", "/super-admin/dashboard"];

export async function reviewCampusRequestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await markCampusRequestUnderReview(await superAdmin(), parseFormData(campusReviewSchema, formData).requestId);
    return successResult("Marked under review.");
  }, { revalidate: platform });
}

export async function approveCampusRequestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const input = parseFormData(campusApproveSchema, formData);
    const { status } = await approveCampusRequest(await superAdmin(), input.requestId, { modules: input.modules, roles: input.roles, limits: limitsFromForm(formData), reviewNote: input.reviewNote });
    return successResult(status === "MODIFIED" ? "Approved with changes. The campus is live." : "Approved. The campus is live.");
  }, { revalidate: platform });
}

export async function rejectCampusRequestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const input = parseFormData(campusRejectSchema, formData);
    await rejectCampusRequest(await superAdmin(), input.requestId, input.reason);
    return successResult("Request rejected.");
  }, { revalidate: platform });
}

export async function setCampusLimitAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const input = parseFormData(campusLimitSchema, formData);
    await setCampusLimitOverride(await superAdmin(), input.organizationId, input.campusLimit);
    return successResult(input.campusLimit === null ? "Campus limit follows the plan." : `Campus limit set to ${input.campusLimit}.`);
  }, { revalidate: platform });
}
