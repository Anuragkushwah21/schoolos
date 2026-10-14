"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { checkbox, id, optionalDate, optionalPhone, optionalText, requiredEmail, requiredText } from "@/lib/validation/common";
import { inviteMessage } from "@/server/auth/account-links";
import { requireTenantForAction } from "@/server/auth/current-user";
import { createPrincipal, savePrincipalProfile, setPrincipalActive } from "@/server/people/principals";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

const principalSchema = z.object({
  firstName: requiredText("the first name", 60),
  lastName: requiredText("the last name", 60),
  email: requiredEmail,
  phone: optionalPhone,
});

/** School Admin: give the school's Principal a login (activation email; they choose the password). */
export async function createPrincipalAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const invite = await createPrincipal(ctx, parseFormData(principalSchema, formData));
      return successResult(`Principal login created. ${inviteMessage(invite)}`);
    },
    { revalidate: "/school-admin/settings/principal" },
  );
}

export async function setPrincipalActiveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { userId, active } = parseFormData(z.object({ userId: id, active: checkbox }), formData);
      await setPrincipalActive(ctx, userId, active);
      return successResult(active ? "Login reopened." : "Login closed. They are signed out everywhere.");
    },
    { revalidate: "/school-admin/settings/principal" },
  );
}

const profileSchema = z.object({
  userId: id,
  employeeId: optionalText(40),
  designation: optionalText(80),
  qualification: optionalText(200),
  experience: optionalText(200),
  appointmentDate: optionalDate,
  joiningDate: optionalDate,
  exitDate: optionalDate,
  dateOfBirth: optionalDate,
  addressLine: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(12),
});

/** School Admin: the Principal's employment record, for their ID card and letters. */
export async function savePrincipalProfileAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { userId, ...input } = parseFormData(profileSchema, formData);
      await savePrincipalProfile(ctx, userId, input);
      return successResult("Employment record saved.");
    },
    { revalidate: ["/school-admin/principal"] },
  );
}
