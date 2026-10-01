import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { env } from "@/lib/env";
import type { MailTransport } from "@/server/mail/mailer";

/**
 * Delivery through an SMTP server — Gmail, Zoho, a school's own server.
 *
 * For Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_SECURE=false,
 * SMTP_USER the Gmail address and SMTP_PASSWORD a 16-letter App Password
 * (Google Account → Security → App passwords), never the account password.
 * Gmail sends from SMTP_USER whatever From is asked for, unless the address is
 * a verified "Send mail as" alias, and allows about 500 messages a day.
 */

export function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

/**
 * "SchoolOS <sender@…>": the display name from MAIL_FROM, the address from
 * SMTP_FROM_EMAIL or SMTP_USER — so a Resend-only MAIL_FROM such as
 * onboarding@resend.dev is never put on SMTP mail.
 */
export function smtpFrom(mailFrom: string, fromEmail: string): string {
  const name = mailFrom.match(/^\s*"?([^"<]*?)"?\s*</)?.[1]?.trim() || "SchoolOS";
  return `${name} <${fromEmail}>`;
}

let transporter: Transporter | null = null;

function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    // A slow server must not hold a Server Action open.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export const smtpTransport: MailTransport = async (mail) => {
  await smtp().sendMail({
    from: smtpFrom(mail.from, env.SMTP_FROM_EMAIL ?? env.SMTP_USER!),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
};
