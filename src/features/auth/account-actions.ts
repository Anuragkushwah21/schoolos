"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { type ActionResult, errorResult, runAction } from "@/lib/action-result";
import { isProduction } from "@/lib/env";
import { roleHomePath } from "@/lib/roles";
import { requestPasswordReset, redeemAccountLink } from "@/server/auth/account-links";
import { PUBLIC_FORM_RATE_LIMIT, rateLimit } from "@/server/auth/rate-limit";
import { createSession, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

type Result = ActionResult<undefined>;

async function clientIp(): Promise<string> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * "Forgot password". The answer is the same whether or not the address has an
 * account, so the form cannot be used to find out who is registered.
 */
export async function forgotPasswordAction(_p: Result, formData: FormData): Promise<Result> {
  return runAction<undefined>(async () => {
    const parsed = z.object({ email: z.email().max(200) }).safeParse({ email: formData.get("email") });
    if (!parsed.success) return errorResult("Enter your email address.", { email: ["Enter a valid email address."] });
    const email = parsed.data.email.toLowerCase();
    // Per address and per account, like sign-in: nobody fills an inbox with reset mail.
    const limited =
      !rateLimit(`forgot:${await clientIp()}`, PUBLIC_FORM_RATE_LIMIT.limit * 2, PUBLIC_FORM_RATE_LIMIT.windowMs).allowed ||
      !rateLimit(`forgot-account:${email}`, PUBLIC_FORM_RATE_LIMIT.limit, PUBLIC_FORM_RATE_LIMIT.windowMs).allowed;
    if (!limited) await requestPasswordReset(email);
    return { status: "success", message: "If that email has a SchoolOS account, a link to reset the password is on its way. It expires in 30 minutes.", data: undefined };
  });
}

const setPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  purpose: z.enum(["ACTIVATION", "PASSWORD_RESET"]),
  password: z.string().max(200),
  confirm: z.string().max(200),
});

/** Choose a password from an activation or reset link, then sign straight in. */
export async function setPasswordAction(_p: Result, formData: FormData): Promise<Result> {
  let destination: string | null = null;
  const result = await runAction<undefined>(async () => {
    const parsed = setPasswordSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return errorResult("This link is not valid. Ask for a new one.");
    const userId = await redeemAccountLink(parsed.data.token, parsed.data.purpose, parsed.data.password, parsed.data.confirm);

    const list = await headers();
    const { token, expiresAt } = await createSession(userId, { ipAddress: await clientIp(), userAgent: list.get("user-agent") });
    (await cookies()).set(SESSION_COOKIE_NAME, token, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/", expires: expiresAt });
    const user = await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() }, select: { role: true } });
    destination = roleHomePath(user.role);
    return { status: "success", data: undefined };
  });
  if (destination) redirect(destination);
  return result;
}
