"use server";

import { z } from "zod";

import { type ActionResult, errorResult, parseFormData, successResult } from "@/lib/action-result";
import { limitsFromForm } from "@/lib/school-roles";
import { id } from "@/lib/validation/common";
import {
  createSchoolAdminSchema,
  offerSchema,
  organizationPlanSchema,
  approveSchoolSchema,
  planActiveSchema,
  planCreateSchema,
  planDraftSchema,
  planIdSchema,
  platformBillSchema,
  platformPaymentSchema,
  platformReasonSchema,
  reviewSchoolSchema,
  schoolModulesSchema,
  schoolRolesSchema,
  subscriptionSchema,
  udiseSchema,
} from "@/lib/validation/platform";
import { requireRoleForAction } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { cancelPlatformBill, createPlatformBill, recordPlatformPayment, voidPlatformPayment } from "@/server/platform/collections";
import { sendMembershipReminders } from "@/server/platform/membership";
import { deleteOffer, saveOffer } from "@/server/platform/offers";
import { changeOrganizationPlan } from "@/server/platform/organizations";
import { archivePlan, createPlan, discardPlanDraft, publishPlan, restorePlan, savePlanDraft, setPlanActive } from "@/server/platform/plans";
import {
  type Credentials,
  createSchoolAdmin,
  markEmailVerified,
  renameSchool,
  resetSchoolAdminPassword,
  setSchoolAdminActive,
  setSchoolModules,
  setSchoolRolesAndLimits,
  setSchoolUdise,
  setSubscription,
  transitionSchool,
} from "@/server/platform/schools";
import { sendVerificationCode } from "@/server/platform/verification";
import { performAction } from "@/server/perform-action";

/**
 * Super Admin actions. Each one re-checks the caller's role itself: a Server
 * Action is a public POST endpoint, and the page that renders its form
 * protects nothing.
 */

type CredentialsResult = ActionResult<{ credentials?: Credentials }>;

const superAdmin = () => requireRoleForAction("SUPER_ADMIN");

export async function approveSchoolAction(
  _previous: CredentialsResult,
  formData: FormData,
): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { schoolId, planId, moduleChoice, optionalModules } = parseFormData(approveSchoolSchema, formData);
      const { credentials } = await transitionSchool(actor, schoolId, "approve", null, {
        planId: planId ?? null,
        modules: moduleChoice === "custom" ? optionalModules : null,
      });
      return successResult(
        credentials
          ? "School approved and administrator account created."
          : "School approved. Add an administrator below.",
        { credentials },
      );
    },
    { revalidate: "/super-admin/dashboard" },
  );
}

const reasonTransition = reviewSchoolSchema.extend({
  transition: z.enum(["reject", "suspend"]),
});

export async function reasonTransitionAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { schoolId, transition, reason } = parseFormData(reasonTransition, formData);
      if (!reason) {
        return {
          status: "error",
          message: "Please correct the highlighted fields.",
          fieldErrors: { reason: ["Give a reason — the school will be told why"] },
        };
      }
      await transitionSchool(actor, schoolId, transition, reason);
      return successResult(transition === "reject" ? "Registration rejected." : "School suspended. Its users have been signed out.");
    },
    { revalidate: "/super-admin/dashboard" },
  );
}

const simpleTransition = z.object({
  schoolId: id,
  transition: z.enum(["review", "reactivate"]),
});

export async function simpleTransitionAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { schoolId, transition } = parseFormData(simpleTransition, formData);
      await transitionSchool(actor, schoolId, transition);
      return successResult(transition === "review" ? "Marked as under review." : "School reactivated.");
    },
    { revalidate: "/super-admin/dashboard" },
  );
}

/** Resend the registrant's code from the review screen. */
export async function resendSchoolCodeAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      await superAdmin();
      const { schoolId } = parseFormData(reviewSchoolSchema, formData);
      const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { slug: true },
      });
      if (!school) return errorResult("That school was not found.");

      const state = await sendVerificationCode(school.slug, { force: true });
      if (state.status === "verified") return successResult("That email is already verified.");

      return state.delivered
        ? successResult("A new code has been sent to the registration contact.")
        : errorResult(
            "The code was generated but the email could not be delivered. Check the mail provider, or verify this address another way.",
          );
    },
    { revalidate: "/super-admin/dashboard" },
  );
}

/** Mark the contact address verified without a code — audited, and rare. */
export async function markEmailVerifiedAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { schoolId } = parseFormData(reviewSchoolSchema, formData);
      await markEmailVerified(actor, schoolId);
      return successResult("Email marked as verified.");
    },
    { revalidate: "/super-admin/dashboard" },
  );
}

export async function createSchoolAdminAction(
  _previous: CredentialsResult,
  formData: FormData,
): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const input = parseFormData(createSchoolAdminSchema, formData);
      const credentials = await createSchoolAdmin(actor, input);
      return successResult("Administrator created.", { credentials });
    },
    { revalidate: "/super-admin/dashboard" },
  );
}

const userIdSchema = z.object({ userId: id });

export async function resetAdminPasswordAction(
  _previous: CredentialsResult,
  formData: FormData,
): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { userId } = parseFormData(userIdSchema, formData);
      const credentials = await resetSchoolAdminPassword(actor, userId);
      return successResult("New password issued.", { credentials });
    },
    { revalidate: "/super-admin/dashboard" },
  );
}

const adminActiveSchema = z.object({ userId: id, active: z.enum(["true", "false"]) });

export async function setAdminActiveAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { userId, active } = parseFormData(adminActiveSchema, formData);
      await setSchoolAdminActive(actor, userId, active === "true");
      return successResult(active === "true" ? "Administrator reactivated." : "Administrator deactivated and signed out.");
    },
    { revalidate: "/super-admin/dashboard" },
  );
}

export async function setSubscriptionAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const input = parseFormData(subscriptionSchema, formData);
      const { campuses } = await setSubscription(actor, input);
      return successResult(campuses > 1 ? `Subscription saved for all ${campuses} campuses of the organization. Campus modules are unchanged — newly included ones are shown to the school as available to switch on.` : "Subscription saved. The school's modules are unchanged — newly included ones are shown to the school as available to switch on.");
    },
    // Every signed-in area reads the plan (sidebar badge, dashboards, Plan & billing, the Super Admin's own pages).
    { revalidate: "/" },
  );
}

export async function saveOfferAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { offerId, ...input } = parseFormData(offerSchema, formData);
      await saveOffer(actor, offerId || null, input);
      return successResult("Offer saved.");
    },
    { revalidate: ["/super-admin/dashboard", "/"], redirectTo: "/super-admin/offers" },
  );
}

const offerIdSchema = z.object({ offerId: id });

export async function deleteOfferAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { offerId } = parseFormData(offerIdSchema, formData);
      await deleteOffer(actor, offerId);
      return successResult("Offer deleted.");
    },
    { revalidate: ["/super-admin/dashboard", "/"] },
  );
}

const planPaths = ["/super-admin/plans", "/super-admin/dashboard", "/", "/register", "/demo", "/school-admin/plan"];

/** Plan Builder: save edits as a draft. Nothing public changes. */
export async function savePlanDraftAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { planId, priceRupees, extraCampusRupees, ...rest } = parseFormData(planDraftSchema, formData);
      const { problems } = await savePlanDraft(actor, planId, {
        ...rest,
        priceMinor: Math.round((priceRupees ?? 0) * 100),
        extraCampusPriceMinor: extraCampusRupees === undefined ? null : Math.round(extraCampusRupees * 100),
        roleLimits: limitsFromForm(formData),
      });
      return successResult(problems.length ? `Draft saved. Before publishing: ${problems.join(" ")}` : "Draft saved. Review the impact, then publish.");
    },
    { revalidate: ["/super-admin/plans"] },
  );
}

export async function publishPlanAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const { impact } = await publishPlan(await superAdmin(), parseFormData(planIdSchema, formData).planId);
      return successResult(`Published.${impact.organizations ? ` ${impact.organizations} organization${impact.organizations === 1 ? "" : "s"} on this plan; their campuses' modules were not changed.` : ""}`);
    },
    { revalidate: planPaths },
  );
}

export async function discardPlanDraftAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      await discardPlanDraft(await superAdmin(), parseFormData(planIdSchema, formData).planId);
      return successResult("Unpublished changes discarded.");
    },
    { revalidate: ["/super-admin/plans"] },
  );
}

export async function createPlanAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      await createPlan(await superAdmin(), parseFormData(planCreateSchema, formData));
      return successResult("Plan created as a draft. Configure it, then publish.");
    },
    { revalidate: ["/super-admin/plans"] },
  );
}

export async function setPlanActiveAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const input = parseFormData(planActiveSchema, formData);
      await setPlanActive(await superAdmin(), input.planId, input.active);
      return successResult(input.active ? "Plan open for new registrations." : "Plan closed for new registrations. Existing customers carry on.");
    },
    { revalidate: planPaths },
  );
}

export async function archivePlanAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      await archivePlan(await superAdmin(), parseFormData(planIdSchema, formData).planId);
      return successResult("Plan archived. Existing customers stay on it until moved.");
    },
    { revalidate: planPaths },
  );
}

export async function restorePlanAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      await restorePlan(await superAdmin(), parseFormData(planIdSchema, formData).planId);
      return successResult("Plan restored, closed to new registrations until you open it.");
    },
    { revalidate: planPaths },
  );
}

export async function setSchoolUdiseAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { schoolId, udiseCode } = parseFormData(udiseSchema, formData);
      await setSchoolUdise(actor, schoolId, udiseCode);
      return successResult(udiseCode ? "UDISE code saved." : "UDISE code cleared.");
    },
    { revalidate: "/super-admin" },
  );
}

/** One school's optional modules (Manage features). */
export async function setSchoolModulesAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { schoolId, followPlan, optionalModules } = parseFormData(schoolModulesSchema, formData);
      await setSchoolModules(actor, { schoolId, followPlan, modules: optionalModules });
      return successResult("Feature access saved. The school sees it on their next page.");
    },
    { revalidate: ["/super-admin"] },
  );
}

/** One school's roles and limits (Manage roles & limits). */
export async function setSchoolRolesAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const input = parseFormData(schoolRolesSchema, formData);
      await setSchoolRolesAndLimits(actor, { ...input, limits: limitsFromForm(formData) });
      return successResult("Roles and limits saved.");
    },
    { revalidate: "/super-admin" },
  );
}

/** Super Admin: correct a school's (campus's) name. */
export async function renameSchoolAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { schoolId, name } = parseFormData(z.object({ schoolId: id, name: z.string().trim().min(2, "Enter the school name").max(150) }), formData);
      await renameSchool(actor, schoolId, name);
      return successResult("School renamed.");
    },
    { revalidate: "/super-admin" },
  );
}

/** Organization page: move every campus to a plan. Success is reported only after the change is saved. */
export async function changeOrganizationPlanAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const result = await changeOrganizationPlan(await superAdmin(), parseFormData(organizationPlanSchema, formData));
      return successResult(result.unchanged ? "Nothing to change: every campus is already on this plan." : `Plan saved for ${result.campuses === 1 ? "the campus" : `all ${result.campuses} campuses`}. Campus modules are unchanged; newly included ones are offered to the school to switch on.`);
    },
    { revalidate: "/" },
  );
}

const reminderSchema = z.object({
  schoolIds: z.preprocess((value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]), z.array(id).min(1, "Choose at least one school").max(200, "Send to at most 200 schools at a time")),
});

/** Membership: email a reminder to one school or many (one per organization). Success says what was sent, what failed and what was skipped. */
export async function sendMembershipRemindersAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const { schoolIds } = parseFormData(reminderSchema, formData);
      const result = await sendMembershipReminders(await superAdmin(), schoolIds);
      const reasons = (kind: "FAILED" | "SKIPPED") => [...new Set(result.outcomes.filter((row) => row.result === kind).map((row) => row.reason).filter(Boolean))].join("; ");
      if (!result.sent && result.failed) return errorResult(`Reminder not delivered: ${reasons("FAILED")}`);
      if (!result.sent && !result.failed) return errorResult(`Nothing sent: ${reasons("SKIPPED")}`);
      return successResult(
        [
          `Reminders sent: ${result.sent}.`,
          result.failed ? `Not delivered: ${result.failed} (${reasons("FAILED")}).` : "",
          result.skipped ? `Skipped: ${result.skipped} (${reasons("SKIPPED")}).` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    },
    { revalidate: ["/super-admin/membership", "/super-admin/dashboard"] },
  );
}

/** Collections: a bill raised to an organization (entered by hand; nothing is charged online). */
export async function createPlatformBillAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const input = parseFormData(platformBillSchema, formData);
      const bill = await createPlatformBill(await superAdmin(), { organizationId: input.organizationId, amountMinor: input.amount, dueOn: input.dueOn, periodStart: input.periodStart, periodEnd: input.periodEnd, description: input.description });
      return successResult(`Bill ${bill.billNo} created. It counts as pending until money is recorded against it.`);
    },
    { revalidate: ["/super-admin/collections", "/super-admin/dashboard"] },
  );
}

/** Collections: money received against a bill. */
export async function recordPlatformPaymentAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const input = parseFormData(platformPaymentSchema, formData);
      const result = await recordPlatformPayment(await superAdmin(), { billId: input.billId, amountMinor: input.amount, receivedOn: input.receivedOn, method: input.method, referenceNo: input.referenceNo, notes: input.notes, idempotencyKey: input.idempotencyKey });
      return successResult(result.repeated ? "Already recorded — this payment was saved once." : "Payment recorded.");
    },
    { revalidate: ["/super-admin/collections", "/super-admin/dashboard"] },
  );
}

export async function voidPlatformPaymentAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const { id: paymentId, reason } = parseFormData(platformReasonSchema, formData);
      await voidPlatformPayment(await superAdmin(), paymentId, reason);
      return successResult("Payment voided. It stays on record and no longer counts.");
    },
    { revalidate: ["/super-admin/collections", "/super-admin/dashboard"] },
  );
}

export async function cancelPlatformBillAction(_previous: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const { id: billId, reason } = parseFormData(platformReasonSchema, formData);
      await cancelPlatformBill(await superAdmin(), billId, reason);
      return successResult("Bill cancelled.");
    },
    { revalidate: ["/super-admin/collections", "/super-admin/dashboard"] },
  );
}
