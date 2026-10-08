import { z } from "zod";

import { ADMISSION_TASK_KEYS } from "@/lib/admission-drives";
import { GENDERS, RELATIONSHIPS } from "@/lib/validation/school";
import { id, optionalEmail, optionalEnum, optionalId, optionalPastDate, optionalText, requiredDate, requiredInt, requiredPhone, requiredText } from "@/lib/validation/common";


export const driveSchema = z.object({
  driveId: optionalId,
  academicSessionId: id,
  name: requiredText("a name for the drive", 120),
  startDate: requiredDate("the start date"),
  endDate: requiredDate("the end date"),
  status: z.enum(["SCHEDULED", "ACTIVE", "PAUSED", "CLOSED", "CANCELLED"]).default("SCHEDULED"),
  notes: optionalText(1000),
});
export type DriveInput = z.infer<typeof driveSchema>;

/** Ticked boxes arrive as task.<key>=on; the rest are absent. */
const tasks = z.preprocess(
  (value) => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []),
  z.array(z.enum(ADMISSION_TASK_KEYS as [string, ...string[]])),
);

export const assignmentSchema = z.object({
  assignmentId: optionalId,
  driveId: id,
  classId: id,
  sectionId: optionalId,
  teacherId: id,
  startDate: requiredDate("the start date"),
  endDate: requiredDate("the end date"),
  capacity: requiredInt(1, 2000),
  permissions: tasks,
});
export type AssignmentInput = z.infer<typeof assignmentSchema>;

export const extendAssignmentSchema = z.object({ assignmentId: id, endDate: requiredDate("the new end date") });

export const reassignSchema = z.object({
  fromAssignmentId: id,
  toAssignmentId: id,
  /** Blank: every pending application of the first assignment. */
  applicationIds: z.preprocess((value) => (Array.isArray(value) ? value : typeof value === "string" && value ? [value] : []), z.array(id)),
});

/** What a teacher fills in for one child. The class comes from the assignment. */
export const driveApplicationSchema = z.object({
  studentFirstName: requiredText("the child's first name", 60),
  studentLastName: requiredText("the child's last name", 60),
  dateOfBirth: optionalPastDate("A date of birth"),
  gender: optionalEnum(GENDERS),
  previousSchool: optionalText(150),
  requestedStreamId: optionalId,
  parentName: requiredText("the parent's name", 120),
  parentRelationship: z.enum(RELATIONSHIPS).default("GUARDIAN"),
  parentPhone: requiredPhone,
  parentEmail: optionalEmail,
  addressLine: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(12),
  notes: optionalText(1000),
});
export type DriveApplicationInput = z.infer<typeof driveApplicationSchema>;

export const driveDecisionSchema = z.object({
  applicationId: id,
  decision: z.enum(["APPROVE", "REJECT", "REQUEST_CORRECTION"]),
  note: optionalText(1000),
});
