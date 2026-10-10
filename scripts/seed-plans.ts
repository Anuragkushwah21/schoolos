/**
 * Put the three subscription tiers on a database.
 *
 * Safe to run on real data and safe to run twice: each tier is upserted by its
 * unique `tier`, and everything is only *created*, never overwritten,
 * so a plan you have since edited in the UI is left exactly as it is.
 *
 *   npx tsx scripts/seed-plans.ts
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, PlanTier } from "../src/generated/prisma/client";
import { connectionConfig } from "../src/server/db/connection";
import { DEFAULT_PLANS } from "../src/lib/plan-catalog";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionConfig(connectionString)) });

/**
 * Starter, Growth and Pro from `DEFAULT_PLANS`. Created as "Price on request"
 * — SchoolOS does not invent prices; set them in Super Admin → Plans.
 */
const PLANS = DEFAULT_PLANS.map((plan) => ({
  ...plan,
  tier: plan.tier as PlanTier,
  optionalModules: [...plan.optionalModules],
  features: [...plan.features],
  priceMinor: 0,
  priceOnRequest: true,
}));

async function main() {
  for (const plan of PLANS) {
    const result = await prisma.plan.upsert({
      where: { tier: plan.tier },
      update: {},
      create: plan,
      select: { id: true, name: true },
    });
    console.log(`  ${plan.tier.padEnd(9)} ${result.name}`);
  }

  console.log(`\n${PLANS.length} plans present on ${new URL(connectionString!).hostname}.`);
  console.log("Edit prices and limits under Platform → Plans.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
