/**
 * Create the platform owner on a fresh database.
 *
 * A new deployment has no accounts at all, and nothing can happen without a
 * Super Admin: schools are approved by one. This is the only way in, so it is
 * a script you run once by hand rather than anything reachable over HTTP.
 *
 *   npx tsx scripts/create-super-admin.ts you@example.com "Asha" "Verma"
 *
 * The password is generated and printed once. Change it after signing in.
 */
import "dotenv/config";

import { randomInt } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma/client";
import { connectionConfig } from "../src/server/db/connection";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionConfig(connectionString)) });

/** Readable aloud: no look-alike characters, always a letter and a digit. */
const LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";

function generatePassword(length = 14): string {
  const alphabet = LETTERS + DIGITS;
  const chars = [LETTERS[randomInt(LETTERS.length)]!, DIGITS[randomInt(DIGITS.length)]!];
  while (chars.length < length) chars.push(alphabet[randomInt(alphabet.length)]!);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

async function main() {
  const [rawEmail, firstName = "Platform", lastName = "Owner"] = process.argv.slice(2);
  if (!rawEmail) {
    throw new Error('Usage: npx tsx scripts/create-super-admin.ts <email> [firstName] [lastName]');
  }

  const email = rawEmail.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (existing) {
    throw new Error(`${email} already exists on this database (role ${existing.role}).`);
  }

  const password = generatePassword();
  const user = await prisma.user.create({
    data: {
      activatedAt: new Date(),
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN",
      firstName,
      lastName,
      schoolId: null,
    },
    select: { id: true },
  });

  const host = new URL(connectionString!).hostname;
  const rule = "─".repeat(58);
  console.log(
    [
      "",
      rule,
      "Super Admin created",
      rule,
      `Database: ${host}`,
      `Email:    ${email}`,
      `Password: ${password}`,
      rule,
      "This password is shown once. Sign in, then change it under Account.",
      "",
    ].join("\n"),
  );

  return user.id;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
