"use server";

import { z } from "zod";

import { type ActionResult, errorResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import {
  createSchoolAdminSchema,
  offerSchema,
  planSchema,
  reviewSchoolSchema,
  subscriptionSchema,
  udiseSchema,
} from "@/lib/validation/platform";
import { requireRoleForAction } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { deleteOffer, saveOffer } from "@/server/platform/offers";
import { updatePlan } from "@/server/platform/plans";
import {
  type Credentials,
  createSchoolAdmin,
  markEmailVerified,
  resetSchoolAdminPassword,
  setSchoolAdminActive,
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
      const { schoolId } = parseFormData(reviewSchoolSchema, formData);
      const { credentials } = await transitionSchool(actor, schoolId, "approve");
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
      await setSubscription(actor, input);
      return successResult("Subscription saved.");
    },
    { revalidate: "/super-admin/dashboard" },
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

export async function updatePlanAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await superAdmin();
      const { planId, priceRupees, ...rest } = parseFormData(planSchema, formData);
      await updatePlan(actor, planId, { ...rest, priceMinor: Math.round(priceRupees * 100) });
      return successResult("Plan saved.");
    },
    { revalidate: ["/super-admin/dashboard", "/"] },
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
