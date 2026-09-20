"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  type ActionResult,
  errorResult,
  parseFormData,
  runAction,
} from "@/lib/action-result";
import { isProduction } from "@/lib/env";
import { roleHomePath } from "@/lib/roles";
import { loginSchema } from "@/lib/validation/auth";
import { recordAudit } from "@/server/audit/log";
import { getCurrentUser } from "@/server/auth/current-user";
import { authenticate } from "@/server/auth/login";
import { LOGIN_RATE_LIMIT, rateLimit, resetRateLimit } from "@/server/auth/rate-limit";
import {
  SESSION_COOKIE_NAME,
  createSession,
  invalidateSession,
} from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

/** The one message every failed sign-in returns, whatever actually went wrong. */
const GENERIC_LOGIN_ERROR = "Incorrect email or password.";

async function requestMetadata() {
  const headerList = await headers();

  // `x-forwarded-for` is a client-controllable header; it is good enough for
  // rate-limit bucketing and audit context, and is never used for authorization.
  const forwarded = headerList.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() ?? null;

  return { ipAddress, userAgent: headerList.get("user-agent") };
}

export async function loginAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  let destination: string | null = null;

  const result = await runAction<undefined>(async () => {
    const { email, password } = parseFormData(loginSchema, formData);
    const { ipAddress, userAgent } = await requestMetadata();

    // Bucket on email as well as IP, so one targeted account cannot be ground
    // down from a rotating pool of addresses.
    const limiterKey = `login:${ipAddress ?? "unknown"}:${email}`;
    const limited = rateLimit(
      limiterKey,
      LOGIN_RATE_LIMIT.limit,
      LOGIN_RATE_LIMIT.windowMs,
    );

    if (!limited.allowed) {
      return errorResult(
        `Too many sign-in attempts. Try again in ${Math.ceil(
          limited.retryAfterSeconds / 60,
        )} minutes.`,
      );
    }

    const outcome = await authenticate(email, password);

    if (!outcome.ok) {
      // The reason is recorded for operators but never shown to the visitor.
      await recordAudit({
        action: "USER_LOGIN_FAILED",
        entityType: "User",
        summary: `Failed sign-in for ${email} (${outcome.reason}).`,
        metadata: { email, reason: outcome.reason },
        ipAddress,
      });

      return errorResult(GENERIC_LOGIN_ERROR);
    }

    const { token, expiresAt } = await createSession(outcome.userId, {
      ipAddress,
      userAgent,
    });

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    resetRateLimit(limiterKey);

    const user = await prisma.user.update({
      where: { id: outcome.userId },
      data: { lastLoginAt: new Date() },
      select: { role: true },
    });

    await recordAudit({
      action: "USER_LOGIN",
      entityType: "User",
      entityId: outcome.userId,
      actorId: outcome.userId,
      schoolId: outcome.schoolId,
      summary: `${email} signed in.`,
      ipAddress,
    });

    destination = roleHomePath(user.role);
    return { status: "success", data: undefined };
  });

  // `redirect()` works by throwing, so it must happen outside `runAction`'s
  // try/catch — otherwise the navigation is swallowed and reported as an error.
  if (destination) redirect(destination);

  return result;
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getCurrentUser();

  if (token) {
    await invalidateSession(token);
  }

  if (user) {
    await recordAudit({
      action: "USER_LOGOUT",
      entityType: "User",
      entityId: user.id,
      actorId: user.id,
      schoolId: user.schoolId,
      summary: `${user.email} signed out.`,
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
