"use server";

import { headers } from "next/headers";

import { z } from "zod";

import { type ActionResult, errorResult, parseFormData, successResult } from "@/lib/action-result";
import { registerSchoolSchema } from "@/lib/validation/platform";
import { registerSchool } from "@/server/platform/registration";
import { sendVerificationCode, verifyCode } from "@/server/platform/verification";
import { performAction } from "@/server/perform-action";

export async function registerSchoolAction(
  _previous: ActionResult<{ reference: string }>,
  formData: FormData,
): Promise<ActionResult<{ reference: string }>> {
  return performAction(
    async () => {
      const input = parseFormData(registerSchoolSchema, formData);
      const forwarded = (await headers()).get("x-forwarded-for");
      const ipAddress = forwarded?.split(",")[0]?.trim() ?? null;

      const outcome = await registerSchool(input, { ipAddress });
      return successResult(undefined, outcome);
    },
    {
      redirectTo: ({ reference }) =>
        `/register/verify?ref=${encodeURIComponent(reference)}`,
    },
  );
}

const referenceSchema = z.object({
  reference: z.string().trim().min(1).max(80),
});

const verifySchema = referenceSchema.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the six-digit code from the email"),
});

async function callerIp() {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? null;
}

/**
 * Check the code a registrant typed. Open to anyone, and it grants nothing:
 * a verified school is still PENDING until a Super Admin approves it.
 */
export async function verifyEmailAction(
  _previous: ActionResult<{ reference: string }>,
  formData: FormData,
): Promise<ActionResult<{ reference: string }>> {
  return performAction(
    async () => {
      const { reference, code } = parseFormData(verifySchema, formData);
      await verifyCode(reference, code, { ipAddress: await callerIp() });
      return successResult(undefined, { reference });
    },
    {
      revalidate: "/platform",
      redirectTo: ({ reference }) => `/register/submitted?ref=${encodeURIComponent(reference)}`,
    },
  );
}

export async function resendCodeAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(async () => {
    const { reference } = parseFormData(referenceSchema, formData);
    const state = await sendVerificationCode(reference, {
      force: true,
      ipAddress: await callerIp(),
    });

    if (state.status === "verified") return successResult("That email is already verified.");

    return state.delivered
      ? successResult("A new code is on its way.")
      : errorResult(
          "We could not send the email just now. Try again in a minute, or ask the school office to help.",
        );
  });
}
