import { z } from "zod";

import {
  checkbox,
  id,
  optionalDate,
  optionalEmail,
  optionalEnum,
  optionalId,
  optionalInt,
  optionalPhone,
  optionalText,
  requiredDate,
  requiredEmail,
  requiredPhone,
  requiredText,
} from "@/lib/validation/common";

/**
 * Input schemas for the School Admin's own data: academic structure, students,
 * guardians and staff. Shared by the forms and the Server Actions.
 *
 * None of these accept a `schoolId`. The school always comes from the session,
 * so there is no field for a tampered form to fill in.
 */

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export const RELATIONSHIPS = ["FATHER", "MOTHER", "GUARDIAN"] as const;
export const STUDENT_STATUSES = ["ACTIVE", "INACTIVE", "TRANSFERRED", "GRADUATED"] as const;
export const TEACHER_STATUSES = ["ACTIVE", "INACTIVE", "ON_LEAVE"] as const;

// -----------------------------------------------------------------------------
// Academic structure
// -----------------------------------------------------------------------------

export const academicSessionSchema = z
  .object({
    name: requiredText("a name such as 2027-28", 20),
    startDate: requiredDate("a start date"),
    endDate: requiredDate("an end date"),
    makeCurrent: checkbox,
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "The session must end after it starts",
    path: ["endDate"],
  });

export const sectionSchema = z.object({
  academicSessionId: id,
  classId: id,
  name: requiredText("a section name", 20),
  streamId: optionalId,
  capacity: optionalInt(1, 200),
  classTeacherId: optionalId,
});

export const updateSectionSchema = z.object({
  sectionId: id,
  name: requiredText("a section name", 20),
  streamId: optionalId,
  capacity: optionalInt(1, 200),
  classTeacherId: optionalId,
});

export const subjectSchema = z.object({
  name: requiredText("a subject name", 60),
  code: z
    .string()
    .trim()
    .min(1, "Enter a short code")
    .max(12, "Keep the code under 12 characters")
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only")
    .transform((value) => value.toUpperCase()),
});

export const streamSchema = z.object({
  name: requiredText("a stream name", 40),
});

export const classSchema = z.object({
  name: requiredText("a class name", 40),
  level: z.coerce.number().int().min(-5).max(20),
});

// -----------------------------------------------------------------------------
// People
// -----------------------------------------------------------------------------

const personalFields = {
  firstName: requiredText("a first name", 60),
  lastName: requiredText("a last name", 60),
  gender: optionalEnum(GENDERS),
};

export const studentFields = {
  ...personalFields,
  admissionNumber: optionalText(30),
  dateOfBirth: optionalDate,
  admissionDate: optionalDate,
  bloodGroup: optionalText(5),
  addressLine: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(12),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalPhone,
};

/**
 * A new student, placed in a section of the current session, with an optional
 * guardian — either an existing parent record or a new one.
 */
export const createStudentSchema = z
  .object({
    ...studentFields,
    sectionId: id,
    rollNumber: optionalText(10),
    guardianMode: z.enum(["none", "existing", "new"]).default("none"),
    existingParentId: optionalId,
    parentFirstName: optionalText(60),
    parentLastName: optionalText(60),
    parentPhone: optionalPhone,
    parentEmail: optionalEmail,
    relationship: optionalEnum(RELATIONSHIPS),
  })
  .superRefine((data, ctx) => {
    if (data.guardianMode === "existing" && !data.existingParentId) {
      ctx.addIssue({ code: "custom", path: ["existingParentId"], message: "Choose a guardian" });
    }
    if (data.guardianMode === "new") {
      if (!data.parentFirstName) {
        ctx.addIssue({ code: "custom", path: ["parentFirstName"], message: "Enter the guardian's first name" });
      }
      if (!data.parentLastName) {
        ctx.addIssue({ code: "custom", path: ["parentLastName"], message: "Enter the guardian's last name" });
      }
      if (!data.parentPhone) {
        ctx.addIssue({ code: "custom", path: ["parentPhone"], message: "Enter the guardian's phone" });
      }
    }
  });

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = z.object({
  studentId: id,
  ...studentFields,
  admissionNumber: requiredText("an admission number", 30),
  status: z.enum(STUDENT_STATUSES),
});

export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const enrollmentSchema = z.object({
  studentId: id,
  academicSessionId: id,
  sectionId: id,
  rollNumber: optionalText(10),
});

export const linkGuardianSchema = z
  .object({
    studentId: id,
    guardianMode: z.enum(["existing", "new"]),
    existingParentId: optionalId,
    parentFirstName: optionalText(60),
    parentLastName: optionalText(60),
    parentPhone: optionalPhone,
    parentEmail: optionalEmail,
    occupation: optionalText(80),
    relationship: z.enum(RELATIONSHIPS),
    isPrimary: checkbox,
  })
  .superRefine((data, ctx) => {
    if (data.guardianMode === "existing" && !data.existingParentId) {
      ctx.addIssue({ code: "custom", path: ["existingParentId"], message: "Choose a guardian" });
    }
    if (data.guardianMode === "new") {
      if (!data.parentFirstName) {
        ctx.addIssue({ code: "custom", path: ["parentFirstName"], message: "Enter a first name" });
      }
      if (!data.parentLastName) {
        ctx.addIssue({ code: "custom", path: ["parentLastName"], message: "Enter a last name" });
      }
      if (!data.parentPhone) {
        ctx.addIssue({ code: "custom", path: ["parentPhone"], message: "Enter a phone number" });
      }
    }
  });

export const updateParentSchema = z.object({
  parentId: id,
  firstName: requiredText("a first name", 60),
  lastName: requiredText("a last name", 60),
  phone: requiredPhone,
  email: optionalEmail,
  occupation: optionalText(80),
  addressLine: optionalText(200),
});

export const portalAccessSchema = z.object({
  personId: id,
  email: requiredEmail,
});

export const teacherFields = {
  ...personalFields,
  employeeId: optionalText(30),
  phone: optionalPhone,
  qualification: optionalText(120),
  joiningDate: optionalDate,
};

export const createTeacherSchema = z.object({
  ...teacherFields,
  email: requiredEmail,
});

export type CreateTeacherInput = z.infer<typeof createTeacherSchema>;

export const updateTeacherSchema = z.object({
  teacherId: id,
  ...teacherFields,
  employeeId: requiredText("an employee ID", 30),
  status: z.enum(TEACHER_STATUSES),
});

export type UpdateTeacherInput = z.infer<typeof updateTeacherSchema>;

export const assignmentSchema = z.object({
  teacherId: id,
  subjectId: id,
  sectionId: id,
});
