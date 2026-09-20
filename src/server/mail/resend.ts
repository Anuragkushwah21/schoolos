import "server-only";

import { env } from "@/lib/env";
import type { MailTransport } from "@/server/mail/mailer";

/**
 * Delivery through Resend's HTTP API.
 *
 * Plain `fetch`, so there is no SDK to keep up to date, and a timeout so a
 * slow provider cannot hold a Server Action open. The key never leaves the
 * server: `env` is server-only and refuses to be imported from client code.
 */

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export const resendTransport: MailTransport = async (mail) => {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: mail.from,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.ok) return;

  // Resend answers failures with a JSON body explaining itself. Surface that
  // rather than a bare status — "domain is not verified" is the usual one, and
  // the caller's log is where someone will look for it.
  const detail = await response
    .json()
    .then((body: { message?: string; name?: string }) => body.message ?? body.name ?? "")
    .catch(() => "");

  throw new Error(
    `Resend refused the message (${response.status})${detail ? `: ${detail}` : ""}`,
  );
};
