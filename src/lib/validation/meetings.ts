import { z } from "zod";

import { id, optionalId, optionalText, optionalTime, optionalUrl, requiredDate, requiredText, requiredTime } from "@/lib/validation/common";

/**
 * Meetings the school office calls — shared by the form, the Server Actions
 * and the REST API. Whether the time is still in the future depends on the
 * school's clock and on the meeting being edited, so the service checks that.
 */

export const MEETING_TYPES = ["PTM", "GENERAL"] as const;
export const MEETING_AUDIENCES = ["ALL", "PARENTS", "STUDENTS", "TEACHERS", "NON_TEACHING_STAFF"] as const;
export const MEETING_GROUPS = ["PARENTS", "STUDENTS", "TEACHERS", "NON_TEACHING_STAFF"] as const;
export const MEETING_SCOPES = ["SCHOOL", "SECTIONS", "PEOPLE"] as const;
export const MEETING_TIME_STATUSES = ["UPCOMING", "ONGOING", "COMPLETED", "CANCELLED"] as const;

export type MeetingGroup = (typeof MEETING_GROUPS)[number];

export const MEETING_AUDIENCE_LABEL: Record<(typeof MEETING_AUDIENCES)[number], string> = {
  ALL: "Everyone",
  PARENTS: "Parents",
  STUDENTS: "Students",
  TEACHERS: "Teachers",
  NON_TEACHING_STAFF: "Non-teaching staff",
};

/** A form's repeated checkbox, a single value, or nothing → a list. */
const list = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
    z.array(item).max(max),
  );

/** "ADM0001, ADM0002" or one per line → a clean list. */
const admissionNumbers = z
  .preprocess(
    (value) =>
      Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean)
          : [],
    z.array(z.string().max(30)).max(500, "At most 500 students per meeting"),
  )
  .default([]);

export const meetingSchema = z
  .object({
    meetingId: optionalId,
    /** A new meeting arranged as a support record's extra class. */
    supportId: optionalId,
    type: z.enum(MEETING_TYPES).default("GENERAL"),
    title: requiredText("a title, e.g. Class 10-A parent meeting", 150),
    description: optionalText(3000),
    date: requiredDate("the date"),
    startMinute: requiredTime("a start time"),
    endMinute: optionalTime,
    location: optionalText(200),
    meetingLink: optionalUrl,
    /**
     * Who is invited. "ALL", or every group ticked, is stored as ALL alone so
     * a group added later is included too.
     */
    audiences: list(z.enum(MEETING_AUDIENCES), 5)
      .refine((values) => values.length > 0, "Choose who the meeting is for")
      .transform((values): Array<(typeof MEETING_AUDIENCES)[number]> =>
        values.includes("ALL") || MEETING_GROUPS.every((group) => values.includes(group)) ? ["ALL"] : [...new Set(values)],
      ),
    scope: z.enum(MEETING_SCOPES).default("SCHOOL"),
    /** SECTIONS: the sections whose students, parents and teachers are invited. */
    sectionIds: list(id, 200),
    /** PEOPLE: teachers and staff members (by record id) who have a login. */
    teacherIds: list(id, 500),
    staffIds: list(id, 500),
    /** PEOPLE: students (and, with PARENTS, their guardians) by admission number. */
    studentAdmissionNumbers: admissionNumbers,
  })
  .refine((data) => data.endMinute === null || data.endMinute > data.startMinute, {
    message: "The meeting must end after it starts",
    path: ["endMinute"],
  })
  .refine((data) => data.scope !== "SECTIONS" || data.sectionIds.length > 0, {
    message: "Choose at least one section",
    path: ["sectionIds"],
  })
  // Staff belong to no section, so a section meeting could never reach them.
  .refine((data) => data.scope !== "SECTIONS" || !data.audiences.includes("NON_TEACHING_STAFF"), {
    message: "Non-teaching staff are not in any section. Invite them with “Whole school” or “Selected people”.",
    path: ["audiences"],
  })
  .refine((data) => data.scope !== "PEOPLE" || data.teacherIds.length + data.staffIds.length + data.studentAdmissionNumbers.length > 0, {
    message: "Pick at least one person",
    path: ["teacherIds"],
  });

export type MeetingInput = z.infer<typeof meetingSchema>;

export const cancelMeetingSchema = z.object({
  meetingId: id,
  reason: optionalText(300),
});
