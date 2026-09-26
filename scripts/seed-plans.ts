/**
 * Put the three subscription tiers on a database.
 *
 * Safe to run on real data and safe to run twice: each tier is upserted by its
 * unique `tier`, and prices and limits are only *created*, never overwritten,
 * so a plan you have since edited in the UI is left exactly as it is.
 *
 *   npx tsx scripts/seed-plans.ts
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, PlanTier } from "../src/generated/prisma/client";
import { connectionConfig } from "../src/server/db/connection";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionConfig(connectionString)) });

/** Prices are in paise, so money stays in integers. */
const PLANS = [
  {
    tier: PlanTier.STARTER,
    name: "Starter",
    description: "For small schools getting started.",
    priceMinor: 1_500_000,
    maxStudents: 300,
    maxTeachers: 25,
    maxAdmins: 2,
    storageMb: 2048,
  },
  {
    tier: PlanTier.STANDARD,
    name: "Standard",
    description: "For growing schools with multiple sections per class.",
    priceMinor: 3_500_000,
    maxStudents: 1200,
    maxTeachers: 80,
    maxAdmins: 5,
    storageMb: 10240,
  },
  {
    tier: PlanTier.PRO,
    name: "Pro",
    description: "Unlimited scale for large institutions.",
    priceMinor: 7_500_000,
    maxStudents: null,
    maxTeachers: null,
    maxAdmins: null,
    storageMb: null,
  },
];

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
