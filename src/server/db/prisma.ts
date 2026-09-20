import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
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
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: isProduction ? ["error"] : ["warn", "error"],
  });
}

type PrismaClientSingleton = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const prisma: PrismaClientSingleton =
  globalForPrisma.prisma ?? createPrismaClient();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
