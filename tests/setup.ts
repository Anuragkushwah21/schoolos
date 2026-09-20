/**
 * Loads `.env.test` before any test module is imported.
 *
 * `override: true` matters: it guarantees tests hit the dedicated test
 * database even if a real `.env` is already present in the shell, so a test
 * run can never truncate development data.
 */
import { config } from "dotenv";

config({ path: ".env.test", override: true });
