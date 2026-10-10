import "server-only";

import { ForbiddenError, RateLimitedError } from "@/lib/errors";
import { rateLimit } from "@/server/auth/rate-limit";
import type { SessionUser } from "@/server/auth/session";
import { createSession, hashSessionToken } from "@/server/auth/session";
import { cleanModules } from "@/lib/school-modules";
import { cleanRoles } from "@/lib/school-roles";
import { prisma } from "@/server/db/prisma";

import { DEMO_EMAIL_DOMAIN, DEMO_MAX_SANDBOXES, DEMO_ROLE_INFO, DEMO_ROLES, DEMO_STARTS_PER_HOUR, type DemoRole } from "./config";
import { createDemoSandbox } from "./seed";

/**
 * Live Demo sessions. A visitor gets their own sandbox school (fictional data,
 * `School.isDemo`), and a server-made session as one of its demo people — no
 * password exists or is shown.
 *
 * Isolation comes from the tenant model itself: the session's user belongs to
 * the sandbox, so every page, action and API is scoped to it by the same
 * `ctx.db` that scopes real schools. Nothing here trusts a school id, role or
 * "demo" flag from the browser: switching role looks the person up inside the
 * sandbox the current session already belongs to.
 */

export function isDemoRole(value: string): value is DemoRole {
  return (DEMO_ROLES as readonly string[]).includes(value);
}

/** The demo person for a role inside one sandbox. */
async function demoUserFor(schoolId: string, role: DemoRole): Promise<{ id: string } | null> {
  const prefix = role === "SCHOOL_ADMIN" ? "admin." : role === "ACCOUNTANT" ? "accountant." : `${role.toLowerCase()}.`;
  return prisma.user.findFirst({
    where: { schoolId, school: { isDemo: true }, email: { startsWith: prefix, endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
}

/** Remove sandboxes past their time (and the oldest beyond the cap). Deleting a school removes everything it owns. */
export async function cleanUpDemoSandboxes(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.school.deleteMany({ where: { isDemo: true, demoExpiresAt: { lt: now } } });
  const live = await prisma.school.findMany({ where: { isDemo: true }, orderBy: { createdAt: "desc" }, skip: DEMO_MAX_SANDBOXES - 1, select: { id: true } });
  if (live.length) await prisma.school.deleteMany({ where: { id: { in: live.map((row) => row.id) }, isDemo: true } });
  return count + live.length;
}

/** The published plans a visitor can try, in display order. */
export async function demoPlans() {
  return prisma.plan.findMany({ where: { status: "PUBLISHED", isActive: true }, orderBy: [{ displayOrder: "asc" }, { priceMinor: "asc" }], select: { id: true, slug: true, name: true, optionalModules: true, availableRoles: true } });
}

/**
 * Put a sandbox on a plan: its subscription, and exactly the plan's modules
 * switched on, so navigation and every server check show that plan. Only
 * ever a demo school — the update is filtered by `isDemo` in the database.
 */
async function applyDemoPlan(schoolId: string, plan: { id: string; optionalModules: string[]; availableRoles: string[] }) {
  await prisma.$transaction([
    prisma.subscription.deleteMany({ where: { schoolId, school: { isDemo: true } } }),
    prisma.school.updateMany({ where: { id: schoolId, isDemo: true }, data: { optionalModules: cleanModules(plan.optionalModules), enabledRoles: cleanRoles(plan.availableRoles), modulesCustomized: false, rolesCustomized: false } }),
    prisma.subscription.create({ data: { schoolId, planId: plan.id, status: "ACTIVE", startsAt: new Date(), notes: "Live Demo sandbox." } }),
  ]);
}

/** Start a demo: a fresh sandbox and a session as `role` in it, on the chosen plan (default: the highest). */
export async function startDemo(role: DemoRole, meta: { ipAddress: string | null; userAgent: string | null }, planSlug: string | null = null) {
  const limited = rateLimit(`demo-start:${meta.ipAddress ?? "unknown"}`, DEMO_STARTS_PER_HOUR, 60 * 60 * 1000);
  if (!limited.allowed) throw new RateLimitedError("Too many demos started from this connection. Please try again later, or carry on with the demo you have open.");
  await cleanUpDemoSandboxes();
  const sandbox = await createDemoSandbox();
  const plans = await demoPlans();
  const plan = plans.find((row) => row.slug === planSlug) ?? plans.at(-1);
  if (plan) await applyDemoPlan(sandbox.schoolId, plan);
  const session = await createSession(sandbox.users[role], { ...meta, expiresAt: sandbox.expiresAt });
  return { ...session, home: DEMO_ROLE_INFO[role].home };
}

/** Switch to another demo person in the same sandbox. The sandbox comes from the session, never the request. */
export async function switchDemoRole(user: SessionUser, sessionToken: string, role: DemoRole) {
  if (!user.isDemo || !user.schoolId) throw new ForbiddenError("This is only available in the Live Demo.");
  const target = await demoUserFor(user.schoolId, role);
  const school = await prisma.school.findFirst({ where: { id: user.schoolId, isDemo: true }, select: { demoExpiresAt: true } });
  if (!target || !school?.demoExpiresAt) throw new ForbiddenError("This is only available in the Live Demo.");
  const session = await createSession(target.id, { expiresAt: school.demoExpiresAt });
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(sessionToken) } });
  return { ...session, home: DEMO_ROLE_INFO[role].home };
}

/** Switch the sandbox to another published plan. The sandbox comes from the session, checked in the database. */
export async function switchDemoPlan(user: SessionUser, planSlug: string): Promise<{ name: string }> {
  if (!user.isDemo || !user.schoolId) throw new ForbiddenError("This is only available in the Live Demo.");
  const school = await prisma.school.findFirst({ where: { id: user.schoolId, isDemo: true }, select: { id: true } });
  if (!school) throw new ForbiddenError("This is only available in the Live Demo.");
  const plan = (await demoPlans()).find((row) => row.slug === planSlug);
  if (!plan) throw new ForbiddenError("That plan is not available.");
  await applyDemoPlan(school.id, plan);
  return { name: plan.name };
}

/** Which plan a sandbox is on, and the plans it can switch to (for the banner). */
export async function demoPlanState(schoolId: string) {
  const [plans, subscription] = await Promise.all([
    demoPlans(),
    prisma.subscription.findFirst({ where: { schoolId, school: { isDemo: true } }, orderBy: { createdAt: "desc" }, select: { plan: { select: { slug: true, name: true } } } }),
  ]);
  return { plans: plans.map((plan) => ({ slug: plan.slug, name: plan.name })), current: subscription?.plan.slug ?? null };
}

/** Start again: this visitor's sandbox is deleted and a fresh one made, in the same role. */
export async function resetDemo(user: SessionUser, sessionToken: string, role: DemoRole, meta: { ipAddress: string | null; userAgent: string | null }) {
  if (!user.isDemo || !user.schoolId) throw new ForbiddenError("This is only available in the Live Demo.");
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(sessionToken) } });
  await prisma.school.deleteMany({ where: { id: user.schoolId, isDemo: true } });
  return startDemo(role, meta);
}

/** Leave the demo: the session and the sandbox go. */
export async function endDemo(user: SessionUser, sessionToken: string) {
  if (!user.isDemo || !user.schoolId) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(sessionToken) } });
  await prisma.school.deleteMany({ where: { id: user.schoolId, isDemo: true } });
}

/** Which demo role the signed-in person is, for the banner. */
export function demoRoleOf(user: Pick<SessionUser, "role" | "email">): DemoRole | null {
  if (user.role === "NON_TEACHING_STAFF") return "ACCOUNTANT";
  return isDemoRole(user.role) ? user.role : null;
}


/** Whether a school is a demo sandbox (for code that has a school id, not a session). */
export async function isDemoSchool(schoolId: string | null | undefined): Promise<boolean> {
  if (!schoolId) return false;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { isDemo: true } });
  return school?.isDemo ?? false;
}
