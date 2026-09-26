import "server-only";

import type { PlanTier } from "@/generated/prisma/enums";
import { RateLimitedError } from "@/lib/errors";
import { slugify } from "@/lib/format";
import type { RegisterSchoolInput } from "@/lib/validation/platform";
import { ConflictError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { hashPassword } from "@/server/auth/password";
import { PUBLIC_FORM_RATE_LIMIT, rateLimit } from "@/server/auth/rate-limit";
import { prisma } from "@/server/db/prisma";
import { isUniqueViolation } from "@/server/db/errors";
import { sendVerificationCode } from "@/server/platform/verification";

/**
 * Public school registration.
 *
 * A registration creates a `School` row in PENDING status and the
 * administrator's own account, with the password they chose. Neither grants
 * access: sign-in refuses every school that is not ACTIVE, and so does session
 * validation on each later request, so the account simply cannot be used until
 * a Super Admin approves the school.
 *
 * Letting them choose the password here means there is no generated secret to
 * email and hand over — one fewer credential in an inbox.
 *
 * Registering also sends a one-time code to the contact address. Until that is
 * verified the school cannot be approved, so registering a school in someone
 * else's name gets no further than an email they can ignore.
 */

/** Slugs that would shadow a route or read as official. */
const RESERVED_SLUGS = new Set(["admin", "api", "platform", "schoolos", "www", "new"]);

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "school";
  const candidates = [base, ...Array.from({ length: 20 }, (_, i) => `${base}-${i + 2}`)];

  const taken = new Set(
    (
      await prisma.school.findMany({
        where: { slug: { in: candidates } },
        select: { slug: true },
      })
    ).map((row) => row.slug),
  );

  const free = candidates.find((slug) => !taken.has(slug) && !RESERVED_SLUGS.has(slug));
  // Twenty namesakes is implausible, but never fail a registration over it.
  return free ?? `${base}-${Date.now().toString(36)}`;
}

export type RegistrationOutcome = { reference: string };

export async function registerSchool(
  input: RegisterSchoolInput,
  meta: { ipAddress: string | null },
): Promise<RegistrationOutcome> {
  const limited = rateLimit(
    `register:${meta.ipAddress ?? "unknown"}`,
    PUBLIC_FORM_RATE_LIMIT.limit,
    PUBLIC_FORM_RATE_LIMIT.windowMs,
  );
  if (!limited.allowed) {
    throw new RateLimitedError(
      "Too many registrations from this connection. Please try again later.",
    );
  }

  // A filled honeypot means a bot. Answer exactly as for a real submission so
  // the bot learns nothing, but store nothing.
  if (input.website) {
    return { reference: slugify(input.name) || "school" };
  }

  // Checked before writing anything, so the message can be useful rather than
  // a unique-constraint failure. The race is still caught below.
  const emailTaken = await prisma.user.count({ where: { email: input.contactEmail } });
  if (emailTaken) {
    throw new ConflictError(
      "An account with that email address already exists. Sign in instead, or register with another address.",
    );
  }

  const plan = input.plan
    ? await prisma.plan.findFirst({
        where: { tier: input.plan as PlanTier, isActive: true },
        select: { id: true },
      })
    : null;

  const [firstName, ...rest] = input.contactName.trim().split(/\s+/);
  const passwordHash = await hashPassword(input.password);

  // Two registrations can race for the same slug; retry once on collision.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const slug = await uniqueSlug(input.name);

    try {
      const school = await prisma.school.create({
        data: {
          slug,
          status: "PENDING",
          name: input.name,
          city: input.city,
          state: input.state,
          affiliationBoard: input.affiliationBoard,
          establishedYear: input.establishedYear,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          users: {
            create: {
              email: input.contactEmail,
              passwordHash,
              role: "SCHOOL_ADMIN",
              firstName: firstName || "School",
              lastName: rest.join(" ") || "Admin",
              phone: input.contactPhone,
            },
          },
          ...(plan
            ? {
                subscriptions: {
                  create: {
                    planId: plan.id,
                    status: "TRIALING",
                    startsAt: new Date(),
                    notes: "Plan requested at registration.",
                  },
                },
              }
            : {}),
        },
        select: { id: true, slug: true, name: true },
      });

      await recordAudit({
        action: "SCHOOL_REGISTERED",
        entityType: "School",
        entityId: school.id,
        schoolId: school.id,
        summary: `${school.name} registered (${input.city}, ${input.state}) with administrator ${input.contactEmail}.`,
        metadata: { requestedPlan: input.plan },
        ipAddress: meta.ipAddress,
      });

      // The code is part of registering, not a separate step the visitor has
      // to ask for. A failure here must not lose the registration itself —
      // they can ask for another code on the next screen.
      await sendVerificationCode(school.slug, { ipAddress: meta.ipAddress }).catch((error) => {
        console.error("[registration] could not send the first code", error);
      });

      return { reference: school.slug };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The email is the only other unique column in this write, and it was
        // already checked — so a collision here is the slug, unless someone
        // registered the same address in the last few milliseconds.
        const stillFree = (await prisma.user.count({ where: { email: input.contactEmail } })) === 0;
        if (stillFree && attempt === 0) continue;

        throw new ConflictError(
          "An account with that email address already exists. Sign in instead, or register with another address.",
        );
      }
      throw error;
    }
  }

  throw new Error("Could not allocate a unique school address.");
}
