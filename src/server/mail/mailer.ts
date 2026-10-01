import "server-only";

import { env, isProduction } from "@/lib/env";
import { resendTransport } from "@/server/mail/resend";
import { smtpConfigured, smtpFrom, smtpTransport } from "@/server/mail/smtp";

/**
 * Outbound email.
 *
 * Delivery goes through SMTP when SMTP_HOST, SMTP_USER and SMTP_PASSWORD are
 * set (e.g. Gmail), else through Resend when `RESEND_API_KEY` is set. Without either the
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

/**
 * The placeholder: log it, clearly marked, so nobody mistakes it for delivery.
 * In production the body is withheld — these messages carry passwords and
 * one-time codes, and server logs are read by more people than a mailbox.
 */
const consoleTransport: MailTransport = async (mail) => {
  if (isProduction) {
    console.error(`[mail] NOT DELIVERED — no provider configured (RESEND_API_KEY). "${mail.subject}" to ${mail.to} was dropped.`);
    throw new Error("No mail provider configured.");
  }
  logMail(mail, "no provider configured");
};

/** Set by tests, and by anyone wiring a different provider. Wins over env. */
let override: MailTransport | null = null;

function activeTransport(): MailTransport {
  if (override) return override;
  if (smtpConfigured()) return smtpTransport;
  return env.RESEND_API_KEY ? resendTransport : consoleTransport;
}

/** The From actually used — for SMTP, the SMTP sender rather than a Resend-only MAIL_FROM. */
function effectiveFrom(): string {
  return !override && smtpConfigured() ? smtpFrom(env.MAIL_FROM, env.SMTP_FROM_EMAIL ?? env.SMTP_USER!) : env.MAIL_FROM;
}

export function setMailTransport(next: MailTransport): void {
  override = next;
}

export function resetMailTransport(): void {
  override = null;
}

/**
 * Why a message was not delivered, in words the school office can act on.
 * Never includes the API key or the message body (which may carry a
 * one-time link).
 */
export function describeMailFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Resend's sandbox sender (onboarding@resend.dev), or an account with no
  // verified domain, delivers only to the address that owns the account. That
  // is why a "forgot password" test to your own inbox works while activation
  // emails to teachers and parents do not.
  if (/only send testing emails|verify a domain|domain is not verified|not verified/i.test(message)) {
    return "The email provider is in test mode and only delivers to its own account owner. Verify your domain at resend.com/domains and set MAIL_FROM to an address on it.";
  }
  // SMTP (nodemailer) errors.
  if (/EAUTH|Invalid login|Username and Password not accepted|535/i.test(message)) {
    return "The email server rejected the SMTP username or password. For Gmail, SMTP_PASSWORD must be an App Password, not the account password.";
  }
  if (/EENVELOPE|No recipients|Recipient address rejected|550/i.test(message)) return "The email server refused this recipient address. Check it is spelled correctly.";
  if (/daily user sending limit|limit exceeded|454|421/i.test(message)) return "The email server's sending limit was reached. Try again later.";
  if (/api key is invalid|invalid api key|unauthori[sz]ed|401|403/i.test(message)) {
    return "The email provider rejected the API key. Check RESEND_API_KEY in the deployment settings.";
  }
  if (/No mail provider configured/i.test(message)) return "No email provider is configured (RESEND_API_KEY is not set).";
  if (/timeout|aborted|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|ESOCKET|EDNS/i.test(message)) return "The email server could not be reached. Try again in a minute.";
  return message.replace(/re_[A-Za-z0-9_]+/g, "re_…").slice(0, 300);
}

/**
 * Send a message.
 *
 * Delivery must never break the operation that triggered it: a school is
 * registered, or an account is created, whether or not the email goes out.
 * Failures are logged and returned — `error` says why, in words the office
 * can act on — so the caller can record the failure and offer a resend.
 *
 * When the provider refuses in development, the message is printed instead.
 * A verification code the provider would not carry is otherwise unrecoverable
 * — it is stored only as a hash — so the registration is stuck with nobody
 * able to finish it. That is a dead end while building, and no help at all in
 * production, where printing a one-time code to the server log would be a
 * leak. Hence development only.
 */
export async function sendMail(mail: Mail): Promise<{ delivered: boolean; error?: string }> {
  const from = effectiveFrom();

  try {
    await activeTransport()({ ...mail, from });
    return { delivered: true };
  } catch (error) {
    const reason = describeMailFailure(error);
    // Subject and recipient only: the body can hold a one-time link.
    console.error(`[mail] failed to send "${mail.subject}" to ${mail.to} from ${from}: ${error instanceof Error ? error.message : String(error)}`);
    if (!isProduction) logMail({ ...mail, from }, "the provider refused it");
    return { delivered: false, error: reason };
  }
}
