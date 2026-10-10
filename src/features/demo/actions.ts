"use server";

import type { Route } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { type ActionResult, errorResult, successResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { isProduction } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/current-user";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { revalidatePath } from "next/cache";

import { demoRoleOf, endDemo, isDemoRole, resetDemo, startDemo, switchDemoPlan, switchDemoRole } from "@/server/demo/sessions";

type Result = ActionResult<undefined>;

async function meta() {
  const list = await headers();
  return { ipAddress: list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: list.get("user-agent") };
}

async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE_NAME, token, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/", expires });
}

/** "Explore as …" on /demo: a fresh sandbox and a session in it. The role is checked against the fixed list. */
export async function startDemoAction(_p: Result, formData: FormData): Promise<Result> {
  const role = String(formData.get("role") ?? "");
  if (!isDemoRole(role)) return errorResult("Choose one of the demo roles.");
  // Only a slug; the plan itself is looked up among published plans on the server.
  const plan = String(formData.get("plan") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || null;
  let home: string;
  try {
    const started = await startDemo(role, await meta(), plan);
    await setSessionCookie(started.token, started.expiresAt);
    home = started.home;
  } catch (error) {
    return errorResult(error instanceof AppError ? error.message : "The demo could not start just now. Please try again.");
  }
  redirect(home as Route);
}

/** Switch to another demo person in the same sandbox (the sandbox comes from the session). */
export async function switchDemoRoleAction(_p: Result, formData: FormData): Promise<Result> {
  const role = String(formData.get("role") ?? "");
  const user = await getCurrentUser();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!user?.isDemo || !token || !isDemoRole(role)) return errorResult("This is only available in the Live Demo.");
  let home: string;
  try {
    const switched = await switchDemoRole(user, token, role);
    await setSessionCookie(switched.token, switched.expiresAt);
    home = switched.home;
  } catch (error) {
    return errorResult(error instanceof AppError ? error.message : "Could not switch role.");
  }
  redirect(home as Route);
}

/** Start over with fresh sample data. */
export async function resetDemoAction(_p: Result): Promise<Result> {
  const user = await getCurrentUser();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!user?.isDemo || !token) return errorResult("This is only available in the Live Demo.");
  let home: string;
  try {
    const fresh = await resetDemo(user, token, demoRoleOf(user) ?? "SCHOOL_ADMIN", await meta());
    await setSessionCookie(fresh.token, fresh.expiresAt);
    home = fresh.home;
  } catch (error) {
    return errorResult(error instanceof AppError ? error.message : "Could not reset the demo.");
  }
  redirect(home as Route);
}

/** Leave the demo: the sample school is deleted. */
export async function exitDemoAction(): Promise<void> {
  const user = await getCurrentUser();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (user?.isDemo && token) await endDemo(user, token);
  store.delete(SESSION_COOKIE_NAME);
  redirect("/demo" as Route);
}

/** Switch the sandbox to another plan; navigation and every check follow the plan's modules. */
export async function switchDemoPlanAction(_p: Result, formData: FormData): Promise<Result> {
  const plan = String(formData.get("plan") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  const user = await getCurrentUser();
  if (!user?.isDemo) return errorResult("This is only available in the Live Demo.");
  try {
    const { name } = await switchDemoPlan(user, plan);
    revalidatePath("/", "layout");
    return successResult(`Now showing the ${name} plan.`);
  } catch (error) {
    return errorResult(error instanceof AppError ? error.message : "Could not switch plan.");
  }
}
