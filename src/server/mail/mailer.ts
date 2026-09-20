import "server-only";

import { env } from "@/lib/env";
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

/** The placeholder: log it, clearly marked, so nobody mistakes it for delivery. */
const consoleTransport: MailTransport = async (mail) => {
  const rule = "─".repeat(60);
  console.info(
    [
      "",
      rule,
      `[mail] NOT DELIVERED — no provider configured`,
      `To:      ${mail.to}`,
      `From:    ${mail.from}`,
      `Subject: ${mail.subject}`,
      rule,
      mail.text,
      rule,
      "",
    ].join("\n"),
  );
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
 */
export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  const from = env.MAIL_FROM;

  try {
    await activeTransport()({ ...mail, from });
    return { delivered: true };
  } catch (error) {
    console.error("[mail] failed to send", mail.subject, "to", mail.to, error);
    return { delivered: false };
  }
}

