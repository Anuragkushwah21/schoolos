import { z } from "zod";

import { passwordSchema } from "@/lib/validation/auth";
import {
  checkbox,
  id,
  optionalDate,
  optionalEnum,
  optionalInt,
  optionalText,
  requiredDate,
  requiredEmail,
  requiredPhone,
  requiredText,
} from "@/lib/validation/common";

export const PLAN_TIERS = ["STARTER", "STANDARD", "PRO"] as const;

/**
 * Public school registration. `website` is a honeypot: it is hidden from people
 * and left blank by them, so anything in it came from a bot.
 */
export const registerSchoolSchema = z
  .object({
    name: requiredText("the school's name", 120),
    city: requiredText("a city", 80),
    state: requiredText("a state", 80),
    affiliationBoard: optionalText(60),
    establishedYear: optionalInt(1800, new Date().getFullYear()),
    contactName: requiredText("your name", 120),
    contactEmail: requiredEmail,
    contactPhone: requiredPhone,
    /**
     * The administrator's own password, chosen here rather than generated and
     * emailed later — one less secret in an inbox, and nothing to hand over.
     * It unlocks nothing until the school is approved.
     */
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
    plan: optionalEnum(PLAN_TIERS),
    website: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterSchoolInput = z.infer<typeof registerSchoolSchema>;

export const reviewSchoolSchema = z.object({
  schoolId: id,
  reason: optionalText(500),
});

export const createSchoolAdminSchema = z.object({
  schoolId: id,
  firstName: requiredText("a first name", 60),
  lastName: requiredText("a last name", 60),
  email: requiredEmail,
  phone: z.string().trim().max(20).optional(),
});

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
  "EXPIRED",
] as const;

export const subscriptionSchema = z.object({
  schoolId: id,
  planId: id,
  status: z.enum(SUBSCRIPTION_STATUSES),
  startsAt: requiredDate("a start date"),
  endsAt: optionalDate,
  notes: optionalText(500),
});

export const offerSchema = z
  .object({
    offerId: z.string().optional(),
    title: requiredText("a title", 120),
    description: optionalText(500),
    priceLabel: optionalText(60),
    ctaLabel: optionalText(40),
    ctaHref: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((value) => value || null)
      .refine(
        (value) => value === null || value.startsWith("/") || /^https:\/\//.test(value),
        "Use a path such as /register or an https:// link",
      ),
    startsAt: requiredDate("a start date"),
    endsAt: optionalDate,
    sortOrder: optionalInt(0, 999),
    isActive: checkbox,
  })
  .refine((data) => !data.endsAt || data.endsAt >= data.startsAt, {
    message: "The end date must be on or after the start date",
    path: ["endsAt"],
  });

export const planSchema = z.object({
  planId: id,
  name: requiredText("a name", 60),
  description: optionalText(300),
  /** Entered in rupees, stored in paise. */
  priceRupees: z.coerce
    .number({ error: "Enter a price" })
    .min(0, "Price cannot be negative")
    .max(10_000_000, "That price is too high"),
  maxStudents: optionalInt(1, 1_000_000),
  maxTeachers: optionalInt(1, 100_000),
  maxAdmins: optionalInt(1, 1_000),
  storageMb: optionalInt(1, 10_000_000),
  isActive: checkbox,
});
