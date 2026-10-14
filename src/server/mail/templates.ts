import "server-only";

import { env } from "@/lib/env";
import type { Mail } from "@/server/mail/mailer";

/**
 * The messages this app sends. Short, plain text, and written to be useful
 * even when they arrive late.
 *
 * A one-time code goes in the body only — never in a link — so forwarding the
 * mail is a deliberate act rather than a click.
 */

export function verificationCodeEmail(input: {
  to: string;
  schoolName: string;
  code: string;
  minutes: number;
}): Mail {
  return {
    to: input.to,
    subject: `${input.code} is your SchoolOS verification code`,
    text: [
      `Your code for registering ${input.schoolName} on SchoolOS is:`,
      "",
      `    ${input.code}`,
      "",
      `It expires in ${input.minutes} minutes and can be used once.`,
      "",
      "Once your email is verified, our team reviews the registration and",
      "sets up your school. You will receive sign-in details by email.",
      "",
      "If you did not register a school on SchoolOS, ignore this message —",
      "nothing has been created in your name that anyone can sign in to.",
    ].join("\n"),
  };
}

/**
 * `password` is present only when the platform generated one — normally the
 * administrator chose their own while registering, and there is no secret to
 * put in an email at all.
 */
export function schoolApprovedEmail(input: {
  to: string;
  contactName: string;
  schoolName: string;
  email: string;
  password?: string;
}): Mail {
  return {
    to: input.to,
    subject: `${input.schoolName} is approved — you can sign in now`,
    text: [
      `Hello ${input.contactName},`,
      "",
      `${input.schoolName} has been approved on SchoolOS. Your school is set up`,
      "with classes Nursery to 12, the common streams and subjects, and the",
      "current academic session.",
      "",
      "Sign in here:",
      `    ${env.APP_URL}/login`,
      "",
      `    Email:    ${input.email}`,
      ...(input.password
        ? [
            `    Password: ${input.password}`,
            "",
            "Please change this password after your first sign-in, under Account.",
          ]
        : ["    Password: the one you chose when you registered."]),
      "",
      "From there you can add sections, staff and students, and hand out",
      "sign-ins to your teachers, students and parents.",
    ].join("\n"),
  };
}

export function schoolRejectedEmail(input: {
  to: string;
  contactName: string;
  schoolName: string;
  reason: string;
}): Mail {
  return {
    to: input.to,
    subject: `About your SchoolOS registration for ${input.schoolName}`,
    text: [
      `Hello ${input.contactName},`,
      "",
      `We were not able to approve the registration for ${input.schoolName}.`,
      "",
      `Reason: ${input.reason}`,
      "",
      "If you think this is a mistake, reply to this message and we will take",
      "another look.",
    ].join("\n"),
  };
}

/**
 * "Activate your SchoolOS account" — a one-time link to choose a password.
 * No password is ever sent.
 */
export function activationEmail(input: { to: string; name: string; role: string; schoolName: string; link: string; days: number }): Mail {
  return {
    to: input.to,
    subject: "Activate your SchoolOS account",
    text: [
      `Hello ${input.name},`,
      "",
      `Your ${input.role} account has been created for ${input.schoolName}.`,
      "",
      "Open the link below to activate your account and create your password:",
      "",
      `    ${input.link}`,
      "",
      `This activation link is secure, works once, and expires in ${input.days} days.`,
      "If it has expired, ask your school office to send a new one.",
      "",
      "If you did not expect this account, please contact your school administrator.",
      "SchoolOS never asks for your password by email.",
      "",
      "Regards,",
      input.schoolName,
      "SchoolOS",
    ].join("\n"),
  };
}

/** A forgotten password: a one-time link to choose a new one. */
export function passwordResetEmail(input: { to: string; name: string; link: string; minutes: number }): Mail {
  return {
    to: input.to,
    subject: "Reset your SchoolOS password",
    text: [
      `Hello ${input.name},`,
      "",
      "Someone asked to reset the password for this SchoolOS account.",
      "Open this link to choose a new password:",
      "",
      `    ${input.link}`,
      "",
      `The link works once and expires in ${input.minutes} minutes.`,
      "If you did not ask for this, ignore this email — your password stays as it is.",
    ].join("\n"),
  };
}

/**
 * A reminder from SchoolOS that a membership (plan or trial) is ending or has
 * ended. It never says anything has been paid or charged: SchoolOS bills by
 * hand, so the next step is always to contact SchoolOS.
 */
export function membershipReminderEmail(input: {
  to: string;
  name: string;
  organization: string;
  plan: string;
  status: "ACTIVE" | "TRIALING" | "PAST_DUE";
  /** The end date as text, or null when none is set. */
  endsOn: string | null;
  /** Days from today to the end date (negative = ended). */
  daysLeft: number | null;
}): Mail {
  const trial = input.status === "TRIALING";
  const ended = input.daysLeft !== null && input.daysLeft < 0;
  const subject =
    input.status === "PAST_DUE"
      ? "Reminder: your SchoolOS membership has a payment due"
      : trial
        ? ended
          ? "Reminder: your SchoolOS trial has ended"
          : "Reminder: your SchoolOS trial is ending"
        : ended
          ? "Reminder: your SchoolOS membership has ended"
          : "Reminder: your SchoolOS membership is ending";
  const line =
    input.status === "PAST_DUE"
      ? `This is a reminder from SchoolOS: the ${input.plan} plan for ${input.organization} has a payment due.`
      : input.daysLeft === null || input.endsOn === null
        ? `This is a reminder from SchoolOS: the ${input.plan} plan for ${input.organization} is up for renewal.`
        : ended
          ? `This is a reminder from SchoolOS: the ${input.plan} ${trial ? "trial" : "plan"} for ${input.organization} ended on ${input.endsOn}.`
          : input.daysLeft === 0
            ? `This is a reminder from SchoolOS: the ${input.plan} ${trial ? "trial" : "plan"} for ${input.organization} ends today, ${input.endsOn}.`
            : `This is a reminder from SchoolOS: the ${input.plan} ${trial ? "trial" : "plan"} for ${input.organization} ends on ${input.endsOn} (days left: ${input.daysLeft}).`;
  return {
    to: input.to,
    subject,
    text: [
      `Hello ${input.name},`,
      "",
      line,
      "",
      "To renew or change your plan, reply to this email or contact SchoolOS.",
      "You can see your plan under Plan & billing:",
      "    " + env.APP_URL + "/school-admin/plan",
      "",
      "Nothing has been charged by this email. SchoolOS confirms renewals and billing with you directly.",
    ].join("\n"),
  };
}
