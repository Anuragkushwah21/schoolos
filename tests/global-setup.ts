/**
 * Brings the test database up to the current schema once per run.
 */
import { execFileSync } from "node:child_process";

import { config } from "dotenv";

export default function globalSetup() {
  const parsed = config({ path: ".env.test", override: true });
  const databaseUrl = parsed.parsed?.DATABASE_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set for tests. Create .env.test.");
  }

  if (!/schoolos_test/.test(databaseUrl)) {
    throw new Error(
      `Refusing to run tests against "${databaseUrl}". ` +
        "The test DATABASE_URL must point at the schoolos_test database.",
    );
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
