"use server";

import { cookies } from "next/headers";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { UnauthenticatedError } from "@/lib/errors";
import { changePasswordSchema } from "@/lib/validation/auth";
import { changePassword } from "@/server/auth/account";
import { requireUserForAction } from "@/server/auth/current-user";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { performAction } from "@/server/perform-action";

export async function changePasswordAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(async () => {
    const user = await requireUserForAction();
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!token) throw new UnauthenticatedError();

    const input = parseFormData(changePasswordSchema, formData);
    await changePassword(user, token, input);

    return successResult("Password changed. Other devices have been signed out.");
  });
}
