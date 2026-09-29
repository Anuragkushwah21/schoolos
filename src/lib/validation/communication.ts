import { z } from "zod";

import {
  checkbox,
  optionalDate,
  optionalId,
  optionalText,
  optionalTime,
  requiredDate,
  requiredText,
} from "@/lib/validation/common";

export const NOTICE_AUDIENCES = ["ALL", "TEACHERS", "STUDENTS", "PARENTS", "NON_TEACHING_STAFF"] as const;
export const NOTICE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

export const NOTICE_SCOPES = ["SCHOOL", "CLASS", "SECTION", "STUDENTS"] as const;

/** "ADM0001, ADM0002" or one per line → a clean list. */
const admissionNumbers = z
  .preprocess(
    (value) =>
      Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean)
          : [],
    z.array(z.string().max(30)).max(500, "At most 500 students per notice"),
  )
  .default([]);

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
    /** Who within the audience: the whole school, a class, a section, or listed students. */
    scope: z.enum(NOTICE_SCOPES).default("SCHOOL"),
    classId: optionalId,
    sectionId: optionalId,
    studentAdmissionNumbers: admissionNumbers,
  })
  .refine((data) => !data.expiresAt || !data.publishAt || data.expiresAt >= data.publishAt, {
    message: "The notice must expire after it is published",
    path: ["expiresAt"],
  })
  .refine((data) => data.scope !== "CLASS" || Boolean(data.classId), { message: "Choose the class", path: ["classId"] })
  .refine((data) => data.scope !== "SECTION" || Boolean(data.sectionId), { message: "Choose the section", path: ["sectionId"] })
  .refine((data) => data.scope !== "STUDENTS" || data.studentAdmissionNumbers.length > 0, {
    message: "List at least one admission number",
    path: ["studentAdmissionNumbers"],
  })
  // Non-teaching staff belong to no class or section, so a class-, section- or
  // student-targeted notice would reach none of them.
  .refine((data) => data.audience !== "NON_TEACHING_STAFF" || data.scope === "SCHOOL", {
    message: "Notices for non-teaching staff go to the whole school",
    path: ["scope"],
  })
  // A notice for particular children is never put on the public website.
  .refine((data) => data.scope === "SCHOOL" || !data.isPublic, {
    message: "Only whole-school notices can go on the public website",
    path: ["isPublic"],
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
