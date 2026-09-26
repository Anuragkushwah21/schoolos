import "server-only";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionResult, runAction } from "@/lib/action-result";

/**
 * The standard tail of every mutating Server Action.
 *
 * Runs the body through `runAction()` (so failures become safe messages),
 * then — only on success — refreshes the affected routes and optionally
 * navigates. `redirect()` works by throwing, so it has to happen here, outside
 * `runAction`'s try/catch, or the navigation would be reported as an error.
 */
export async function performAction<T>(
  body: () => Promise<ActionResult<T>>,
  options: {
    /** Route prefixes whose pages should re-render with fresh data. */
    revalidate?: string | string[];
    redirectTo?: Route | ((data: T) => Route | null);
  } = {},
): Promise<ActionResult<T>> {
  const result = await runAction(body);

  if (result.status !== "success") return result;

  const paths = options.revalidate
    ? Array.isArray(options.revalidate)
      ? options.revalidate
      : [options.revalidate]
    : [];

  for (const path of paths) revalidatePath(path, "layout");

  const target =
    typeof options.redirectTo === "function"
      ? options.redirectTo(result.data)
      : options.redirectTo;

  if (target) redirect(target);

  return result;
}
