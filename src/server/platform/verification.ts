import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { AppError, NotFoundError, RateLimitedError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/db/prisma";
import { sendMail } from "@/server/mail/mailer";
import { verificationCodeEmail } from "@/server/mail/templates";

/**
 * Email ownership for a school registration.
 *
 * A six-digit code is guessable in a million tries, so the code itself is not
 * the whole defence: each code carries its own attempt counter, expires in ten
 * minutes, is consumed on first use, and resending is throttled. Only the
 * SHA-256 hash is stored, and the comparison is constant-time.
 *
 * Verification proves the registrant can read that inbox. It grants nothing on
 * its own — a verified school is still PENDING until a Super Admin approves it.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
/** Wait between sends, so the inbox cannot be used as a weapon. */
export const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;

function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function codesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export type VerificationState =
  | { status: "verified" }
  | {
      status: "pending";
      email: string;
      canResendInSeconds: number;
      /**
       * Whether the provider accepted the message. False means the code is in
       * the database but nobody received it — worth saying out loud rather
       * than leaving someone waiting for an email that will never arrive.
       */
      delivered: boolean;
    };

/**
 * Issue a code for a pending school and email it.
 *
 * Any code already outstanding for the school is superseded, so a second
 * request does not leave two live codes for one inbox.
 */
export async function sendVerificationCode(
  slug: string,
  options: { force?: boolean; ipAddress?: string | null } = {},
): Promise<VerificationState> {
  const school = await prisma.school.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      contactEmail: true,
      contactEmailVerifiedAt: true,
      status: true,
    },
  });
  if (!school) throw new NotFoundError("That registration was not found.");
  if (school.contactEmailVerifiedAt) return { status: "verified" };

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [latest, sentThisHour] = await Promise.all([
    prisma.emailVerification.findFirst({
      where: { schoolId: school.id, purpose: "SCHOOL_REGISTRATION" },
      orderBy: { createdAt: "desc" },
      select: { id: true, lastSentAt: true },
    }),
    prisma.emailVerification.count({
      where: { schoolId: school.id, purpose: "SCHOOL_REGISTRATION", createdAt: { gte: hourAgo } },
    }),
  ]);

  const secondsSinceLast = latest
    ? Math.floor((now.getTime() - latest.lastSentAt.getTime()) / 1000)
    : Number.MAX_SAFE_INTEGER;

  if (!options.force && latest && secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
    // Not an error on the first send of a registration — the caller asked for
    // a code and one is already on its way.
    return {
      status: "pending",
      email: school.contactEmail,
      canResendInSeconds: RESEND_COOLDOWN_SECONDS - secondsSinceLast,
      delivered: true,
    };
  }

  if (sentThisHour >= MAX_SENDS_PER_HOUR) {
    throw new RateLimitedError(
      "Too many codes have been sent for this registration. Please try again in an hour.",
    );
  }

  const code = generateCode();

  await prisma.$transaction([
    // Supersede anything outstanding, so only the newest code can be used.
    prisma.emailVerification.updateMany({
      where: { schoolId: school.id, purpose: "SCHOOL_REGISTRATION", consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.emailVerification.create({
      data: {
        email: school.contactEmail,
        purpose: "SCHOOL_REGISTRATION",
        codeHash: hashCode(code),
        schoolId: school.id,
        expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000),
        lastSentAt: now,
      },
    }),
  ]);

  const { delivered } = await sendMail(
    verificationCodeEmail({
      to: school.contactEmail,
      schoolName: school.name,
      code,
      minutes: CODE_TTL_MINUTES,
    }),
  );

  await recordAudit({
    action: "SCHOOL_EMAIL_CODE_SENT",
    entityType: "School",
    entityId: school.id,
    schoolId: school.id,
    summary: delivered
      ? `Verification code sent to ${school.contactEmail}.`
      : `Verification code generated for ${school.contactEmail}, but the email could not be delivered.`,
    ipAddress: options.ipAddress ?? null,
  });

  return {
    status: "pending",
    email: school.contactEmail,
    canResendInSeconds: RESEND_COOLDOWN_SECONDS,
    delivered,
  };
}

/** What the verify screen needs to render, without leaking who registered. */
export async function getVerificationState(slug: string): Promise<VerificationState | null> {
  const school = await prisma.school.findUnique({
    where: { slug },
    select: { id: true, contactEmail: true, contactEmailVerifiedAt: true },
  });
  if (!school) return null;
  if (school.contactEmailVerifiedAt) return { status: "verified" };

  const latest = await prisma.emailVerification.findFirst({
    where: { schoolId: school.id, purpose: "SCHOOL_REGISTRATION", consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { lastSentAt: true },
  });

  const elapsed = latest ? Math.floor((Date.now() - latest.lastSentAt.getTime()) / 1000) : Number.MAX_SAFE_INTEGER;

  return {
    status: "pending",
    email: maskEmail(school.contactEmail),
    canResendInSeconds: Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed),
    delivered: true,
  };
}

/** `kavita@example.com` → `k•••••a@example.com`, so the screen can confirm without exposing. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "•••";
  if (name.length <= 2) return `${name[0]}•••@${domain}`;
  return `${name[0]}${"•".repeat(Math.min(name.length - 2, 6))}${name[name.length - 1]}@${domain}`;
}

/**
 * Check a code. Every failure returns the same message — wrong, expired,
 * consumed and "no such registration" are indistinguishable to the caller.
 */
export async function verifyCode(
  slug: string,
  code: string,
  meta: { ipAddress?: string | null } = {},
): Promise<void> {
  const generic = new AppError(
    "VALIDATION",
    "That code is not right, or it has expired. Ask for a new one.",
  );

  const school = await prisma.school.findUnique({
    where: { slug },
    select: { id: true, name: true, contactEmail: true, contactEmailVerifiedAt: true },
  });
  if (!school) throw generic;
  if (school.contactEmailVerifiedAt) return;

  const verification = await prisma.emailVerification.findFirst({
    where: { schoolId: school.id, purpose: "SCHOOL_REGISTRATION", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!verification) throw generic;

  if (verification.expiresAt.getTime() <= Date.now()) throw generic;

  // Claim an attempt before comparing, in one conditional write: parallel
  // guesses cannot all slip under the limit by reading the same count.
  const claimed = await prisma.emailVerification.updateMany({
    where: { id: verification.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (!claimed.count) {
    throw new RateLimitedError("Too many attempts on this code. Ask for a new one.");
  }

  if (!codesMatch(hashCode(code), verification.codeHash)) {
    // The last allowed attempt is also the code's last moment of life.
    if (verification.attempts + 1 >= MAX_ATTEMPTS) {
      await prisma.emailVerification.update({
        where: { id: verification.id },
        data: { consumedAt: new Date() },
      });
      await recordAudit({
        action: "SCHOOL_EMAIL_VERIFY_FAILED",
        entityType: "School",
        entityId: school.id,
        schoolId: school.id,
        summary: `Verification code for ${school.contactEmail} retired after ${MAX_ATTEMPTS} wrong attempts.`,
        ipAddress: meta.ipAddress ?? null,
      });
    }

    throw generic;
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.emailVerification.update({
      where: { id: verification.id },
      data: { consumedAt: now },
    }),
    prisma.school.update({
      where: { id: school.id },
      data: { contactEmailVerifiedAt: now },
    }),
  ]);

  await recordAudit({
    action: "SCHOOL_EMAIL_VERIFIED",
    entityType: "School",
    entityId: school.id,
    schoolId: school.id,
    summary: `${school.contactEmail} verified for ${school.name}.`,
    ipAddress: meta.ipAddress ?? null,
  });
}

/** Housekeeping: drop codes that are long dead. */
export async function deleteExpiredCodes(): Promise<number> {
  const { count } = await prisma.emailVerification.deleteMany({
    where: { expiresAt: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return count;
}
