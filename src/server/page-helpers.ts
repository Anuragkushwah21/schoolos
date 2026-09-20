import "server-only";

import { notFound } from "next/navigation";

import { NotFoundError } from "@/lib/errors";

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
