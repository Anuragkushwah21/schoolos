import "server-only";

import type { InquiryStatus, InquiryTopic } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import { NotFoundError, RateLimitedError } from "@/lib/errors";
import { humanize } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import { PUBLIC_FORM_RATE_LIMIT, rateLimit } from "@/server/auth/rate-limit";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { sendMail } from "@/server/mail/mailer";

/**
 * Messages from the public contact page to the platform owner.
 *
 * Anyone may send one — a school that has not registered yet is exactly who
 * this is for — so the write is rate-limited per address and carries a
 * honeypot. Reading and handling them is Super Admin only.
 */

export type InquiryInput = {
  name: string;
  schoolName: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  topic: InquiryTopic;
  message: string;
  /** The honeypot. Anything in it means a bot filled the form. */
  website?: string;
};

export async function submitInquiry(
  input: InquiryInput,
  meta: { ipAddress: string | null },
): Promise<{ id: string | null }> {
  const limited = rateLimit(
    `inquiry:${meta.ipAddress ?? "unknown"}`,
    PUBLIC_FORM_RATE_LIMIT.limit,
    PUBLIC_FORM_RATE_LIMIT.windowMs,
  );
  if (!limited.allowed) {
    throw new RateLimitedError(
      "You have sent several messages already. Please try again in a little while.",
    );
  }

  // Looks like success to the bot, stores nothing.
  if (input.website) return { id: null };

  const inquiry = await prisma.platformInquiry.create({
    data: {
      name: input.name,
      schoolName: input.schoolName,
      email: input.email,
      phone: input.phone,
      city: input.city,
      topic: input.topic,
      message: input.message,
      ipAddress: meta.ipAddress,
    },
    select: { id: true },
  });

  await recordAudit({
    action: "INQUIRY_RECEIVED",
    entityType: "PlatformInquiry",
    entityId: inquiry.id,
    summary: `${humanize(input.topic)} enquiry from ${input.name}${input.schoolName ? ` (${input.schoolName})` : ""}.`,
    ipAddress: meta.ipAddress,
  });

  if (env.PLATFORM_CONTACT_EMAIL) {
    // A failed notification must not lose the enquiry: it is already stored and
    // visible in the Super Admin inbox.
    try {
      await sendMail({
        to: env.PLATFORM_CONTACT_EMAIL,
        subject: `New ${humanize(input.topic).toLowerCase()} enquiry — ${input.schoolName ?? input.name}`,
        text: [
          `From: ${input.name} <${input.email}>`,
          input.phone ? `Phone: ${input.phone}` : null,
          input.schoolName ? `School: ${input.schoolName}` : null,
          input.city ? `City: ${input.city}` : null,
          `Topic: ${humanize(input.topic)}`,
          "",
          input.message,
        ]
          .filter((line) => line !== null)
          .join("\n"),
      });
    } catch (error) {
      console.error("[inquiry] notification email failed", error);
    }
  }

  return inquiry;
}

export async function listInquiries(
  actor: SessionUser,
  filters: { status?: InquiryStatus | null; take?: number } = {},
) {
  assertRole(actor, "SUPER_ADMIN");

  const [rows, counts] = await Promise.all([
    prisma.platformInquiry.findMany({
      where: filters.status ? { status: filters.status } : {},
      orderBy: { createdAt: "desc" },
      take: filters.take ?? 100,
    }),
    prisma.platformInquiry.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const count = (status: InquiryStatus) =>
    counts.find((row) => row.status === status)?._count._all ?? 0;

  return { rows, counts: { NEW: count("NEW"), CONTACTED: count("CONTACTED"), CLOSED: count("CLOSED") } };
}

export async function countNewInquiries(actor: SessionUser): Promise<number> {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.platformInquiry.count({ where: { status: "NEW" } });
}

export async function setInquiryStatus(
  actor: SessionUser,
  inquiryId: string,
  status: InquiryStatus,
): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");

  const inquiry = await prisma.platformInquiry.findUnique({
    where: { id: inquiryId },
    select: { id: true, name: true },
  });
  if (!inquiry) throw new NotFoundError("That enquiry was not found.");

  await prisma.platformInquiry.update({
    where: { id: inquiry.id },
    data: { status, handledAt: status === "NEW" ? null : new Date() },
  });

  await recordAudit({
    action: "INQUIRY_UPDATED",
    entityType: "PlatformInquiry",
    entityId: inquiry.id,
    actorId: actor.id,
    summary: `Enquiry from ${inquiry.name} marked ${status.toLowerCase()}.`,
  });
}
