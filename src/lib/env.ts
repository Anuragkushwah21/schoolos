import { z } from "zod";

/**
 * Environment configuration.
 *
 * This module is server-only. No value here is prefixed with `NEXT_PUBLIC_`,
 * so nothing in it is ever sent to the browser. The explicit window guard
 * turns an accidental client import into a loud failure instead of a silent
 * `undefined`.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "`@/lib/env` is server-only and must never be imported from client code.",
  );
}

const envSchema = z.object({
  /** PostgreSQL connection string (Supabase / Neon / local). */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /**
   * Secret used to sign session cookies. 32 chars is the floor; the
   * `.env.example` recommends `openssl rand -base64 48`.
   */
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),

  /** Public origin of this deployment. */
  APP_URL: z.url().default("http://localhost:3000"),

  /**
   * The From address on outbound email. With Resend this must be an address on
   * a domain verified in that account, or their sandbox sender
   * (`onboarding@resend.dev`), which only delivers to the account's own owner.
   */
  MAIL_FROM: z.string().min(1).default("SchoolOS <onboarding@resend.dev>"),

  /**
   * Resend API key. Optional: without it, mail is written to the server log
   * instead of being delivered.
   */
  RESEND_API_KEY: z.string().trim().min(1).optional(),

  /**
   * Where uploaded lesson documents are kept. Defaults to `./uploads`, which is
   * gitignored. Never inside `public/`: files are served only through the
   * authorized download route.
   */
  UPLOAD_DIR: z.string().trim().min(1).optional(),

  /**
   * The platform owner's public contact details, shown on /contact. Optional:
   * without them the page shows only the enquiry form. New enquiries are also
   * emailed to PLATFORM_CONTACT_EMAIL when it is set.
   */
  PLATFORM_CONTACT_EMAIL: z.email().optional(),
  PLATFORM_CONTACT_PHONE: z.string().trim().min(5).max(30).optional(),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Report every problem at once, and never echo the offending values —
    // this message can reach CI logs.
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        "Copy `.env.example` to `.env` and fill in the values.",
    );
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
