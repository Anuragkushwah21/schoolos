/**
 * Development helper: mint a session for a seeded account and print the token.
 *
 * Used to exercise authenticated routes with curl without driving the browser.
 * Refuses to run against production.
 */
import "dotenv/config";

import { createHash, randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to mint a session against production.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: tsx scripts/mint-dev-session.ts <email>");

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const token = randomBytes(32).toString("base64url");

  await prisma.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId: user.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  console.log(token);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
