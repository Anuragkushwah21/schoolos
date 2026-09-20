import { z } from "zod";

import {
  checkbox,
  optionalDate,
  optionalText,
  optionalTime,
  requiredDate,
  requiredText,
} from "@/lib/validation/common";

export const NOTICE_AUDIENCES = ["ALL", "TEACHERS", "STUDENTS", "PARENTS"] as const;
export const NOTICE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

export const noticeSchema = z
  .object({
    noticeId: z.string().optional(),
    title: requiredText("a title", 150),
    body: requiredText("the notice text", 5000),
    audience: z.enum(NOTICE_AUDIENCES),
    status: z.enum(NOTICE_STATUSES),
    isPublic: checkbox,
    publishAt: optionalDate,
    expiresAt: optionalDate,
  })
  .refine((data) => !data.expiresAt || !data.publishAt || data.expiresAt >= data.publishAt, {
    message: "The notice must expire after it is published",
    path: ["expiresAt"],
  });

export type NoticeInput = z.infer<typeof noticeSchema>;

export const eventSchema = z
  .object({
    eventId: z.string().optional(),
    title: requiredText("a title", 150),
    description: optionalText(3000),
    date: requiredDate("the date"),
    startMinute: optionalTime,
    endMinute: optionalTime,
    location: optionalText(120),
    imageUrl: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || null)
      .refine((value) => value === null || /^https:\/\//.test(value), "Use an https:// image link"),
    isPublished: checkbox,
  })
  .refine(
    (data) => data.startMinute === null || data.endMinute === null || data.endMinute > data.startMinute,
    { message: "The event must end after it starts", path: ["endMinute"] },
  );

export type EventInput = z.infer<typeof eventSchema>;
