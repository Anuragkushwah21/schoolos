/**
 * Loads `.env.test` before any test module is imported.
 *
 * `override: true` matters: it guarantees tests hit the dedicated test
 * database even if a real `.env` is already present in the shell, so a test
 * run can never truncate development data.
 */
import { tmpdir } from "node:os";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.test", override: true });

// Uploaded lesson files go to a scratch directory, never the project's own.
process.env.UPLOAD_DIR ??= path.join(tmpdir(), "schoolos-test-uploads");
