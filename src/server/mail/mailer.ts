import "server-only";

import { env, isProduction } from "@/lib/env";
import { resendTransport } from "@/server/mail/resend";

/**
 * Outbound email.
 *
 * Delivery goes through Resend when `RESEND_API_KEY` is set. Without a key the
 * message is written to the server log instead — deliberately visible rather
 * than a silent no-op, so a one-time code is readable in the terminal during
 * development and an unconfigured deployment is loud about what it did not
 * send.
 *
 * Swapping in another provider is one function; see `setMailTransport`.
 */

export type Mail = {
  to: string;
  subject: string;
  /** Plain text. No HTML: these are short, transactional, and safer this way. */
  text: string;
};

export type MailTransport = (mail: Mail & { from: string }) => Promise<void>;

/** Print a message to the server log, banner and all. */
function logMail(mail: Mail & { from: string }, reason: string): void {
  const rule = "─".repeat(60);
  console.info(
    [
      "",
      rule,
      `[mail] NOT DELIVERED — ${reason}`,
      `To:      ${mail.to}`,
      `From:    ${mail.from}`,
      `Subject: ${mail.subject}`,
      rule,
      mail.text,
      rule,
      "",
    ].join("\n"),
  );
}

/** The placeholder: log it, clearly marked, so nobody mistakes it for delivery. */
const consoleTransport: MailTransport = async (mail) => {
  logMail(mail, "no provider configured");
};

/** Set by tests, and by anyone wiring a different provider. Wins over env. */
let override: MailTransport | null = null;

function activeTransport(): MailTransport {
  if (override) return override;
  return env.RESEND_API_KEY ? resendTransport : consoleTransport;
}

export function setMailTransport(next: MailTransport): void {
  override = next;
}

export function resetMailTransport(): void {
  override = null;
}

/**
 * Send a message.
 *
 * Delivery must never break the operation that triggered it: a school is
 * registered, or an account is created, whether or not the email goes out.
 * Failures are logged and swallowed, and the caller is told nothing it would
 * have to handle.
 *
 * When the provider refuses in development, the message is printed instead.
 * A verification code the provider would not carry is otherwise unrecoverable
 * — it is stored only as a hash — so the registration is stuck with nobody
 * able to finish it. That is a dead end while building, and no help at all in
 * production, where printing a one-time code to the server log would be a
 * leak. Hence development only.
 */
export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  const from = env.MAIL_FROM;

  try {
    await activeTransport()({ ...mail, from });
    return { delivered: true };
  } catch (error) {
    console.error("[mail] failed to send", mail.subject, "to", mail.to, error);
    if (!isProduction) logMail({ ...mail, from }, "the provider refused it");
    return { delivered: false };
  }
}

