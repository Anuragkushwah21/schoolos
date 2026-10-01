import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { connectionConfig } from "@/server/db/connection";
import { env, isProduction } from "@/lib/env";

/**
 * Prisma Client singleton.
 *
 * Prisma 7 talks to PostgreSQL through a driver adapter rather than the old
 * Rust engine, which is what lets this run on serverless platforms and behind
 * connection poolers (Supabase / Neon / PgBouncer) without extra plumbing.
 *
 * In development Next.js hot-reloads modules on every edit; without the
 * `globalThis` cache each reload would open a fresh pool and exhaust the
 * database's connection limit.
 */
function createPrismaClient() {
  const adapter = new PrismaPg(connectionConfig(env.DATABASE_URL));

  if (!isProduction) {
    // Say which database this is, once per pool. Working against the wrong one
    // is silent — everything succeeds, into a database nobody is looking at —
    // and this is the cheapest way to make it obvious. Host and database name
    // only; the credentials stay out of the log.
    const url = new URL(env.DATABASE_URL);
    console.info(`[db] ${url.host}${url.pathname}`);
  }

  return new PrismaClient({
    adapter,
    log: isProduction ? ["error"] : ["warn", "error"],
  });
}

type PrismaClientSingleton = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
  /** The class the cached instance was built from — see below. */
  prismaCtor: unknown;
  /** The database it was pointed at — see below. */
  prismaUrl: string | undefined;
};

/**
 * The cache is keyed on what the client was built *from*, not merely on "is
 * there one already". Two things can change underneath it:
 *
 * The generated class. `prisma generate` rewrites `src/generated/prisma`, the
 * dev server hot-reloads those modules, and `PrismaClient` becomes a
 * *different* class object. The instance parked on `globalThis`, however,
 * survives every reload — so without this check a client built before a schema
 * change keeps serving the old shape for the rest of the session, and every
 * query against a new column fails with "Unknown field", pointing at the query
 * rather than at the stale client.
 *
 * The database URL. Editing `DATABASE_URL` in `.env` reloads the env but not
 * this pool, so the app would go on reading and writing the previous database
 * while every config says otherwise. That failure is silent and expensive:
 * registrations land somewhere nobody is looking. Comparing the URL rebuilds
 * the pool instead.
 */
const isStale =
  globalForPrisma.prisma !== undefined &&
  (globalForPrisma.prismaCtor !== PrismaClient ||
    globalForPrisma.prismaUrl !== env.DATABASE_URL);

if (isStale) {
  // Drop the old client, but do not close its pool. Next.js keeps separate
  // module graphs (pages, route handlers) that reload at different moments;
  // one graph may still hold the old client, and closing its pool under it
  // fails every query there with "Cannot use a pool after calling end on the
  // pool". An idle pool is released when nothing references it any more —
  // this only ever happens in development, after a schema or URL change.
  globalForPrisma.prisma = undefined;
}

export const prisma: PrismaClientSingleton =
  globalForPrisma.prisma ?? createPrismaClient();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaCtor = PrismaClient;
  globalForPrisma.prismaUrl = env.DATABASE_URL;
}
