import "server-only";

import { notFound } from "next/navigation";

import { ForbiddenError, NotFoundError } from "@/lib/errors";

/**
 * Await a data-layer call from a page, rendering the 404 page when it throws
 * `NotFoundError`. A record in another school is indistinguishable from one
 * that does not exist, so both end here.
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * As `orNotFound`, but a refusal is hidden as well as a miss.
 *
 * For a teacher, a section or a child they are not entitled to must not be
 * distinguishable from one that does not exist — otherwise a walk through
 * guessed ids tells them who else the school teaches. Reserved for pages whose
 * id comes from the URL and whose refusal carries no instruction to the user.
 */
export async function orHidden<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}
