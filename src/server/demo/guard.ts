import { ForbiddenError } from "@/lib/errors";

/**
 * Refuse something a Live Demo visitor must never do — anything that reaches
 * outside the sandbox (email, real accounts, API tokens, campuses, plans).
 * `isDemo` comes from the session's school row, never from the browser.
 */
export function assertNotDemo(user: { isDemo?: boolean }, what = "This"): void {
  if (user.isDemo) throw new ForbiddenError(`${what} is turned off in the Live Demo. Register your school to use it for real.`);
}
