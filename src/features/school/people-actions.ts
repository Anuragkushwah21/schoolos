"use server";

import type { Route } from "next";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { checkbox, id, optionalEmail } from "@/lib/validation/common";
import {
  assignmentSchema,
  createStudentSchema,
  createTeacherSchema,
  enrollmentSchema,
  linkGuardianSchema,
  portalAccessSchema,
  updateParentSchema,
  updateStudentSchema,
  updateTeacherSchema,
} from "@/lib/validation/school";
import { resolveSectionChoice } from "@/server/academics/structure";
import { requireTenantForAction } from "@/server/auth/current-user";
import { resetPortalPassword } from "@/server/people/accounts";
import {
  createStudent,
  deleteStudent,
  enrollStudent,
  grantParentPortal,
  grantStudentPortal,
  linkGuardian,
  unlinkGuardian,
  updateParent,
  updateStudent,
} from "@/server/people/students";
import {
  assignSubject,
  createTeacher,
  deleteTeacher,
  unassignSubject,
  updateTeacher,
} from "@/server/people/teachers";
import { performAction } from "@/server/perform-action";
import type { Credentials } from "@/server/platform/schools";

type Result = ActionResult<undefined>;
type CredentialsResult = ActionResult<{ credentials?: Credentials }>;

const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const REVALIDATE = "/school-admin";

// -----------------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------------

const loginStepSchema = z.object({ studentLoginEmail: optionalEmail, parentLogin: checkbox });

type CreateStudentResult = ActionResult<{
  studentId: string;
  credentialsList?: Credentials[];
  next?: { href: string; label: string };
}>;

/**
 * Add a student — and, from the form's "Login access" step, optionally their
 * sign-in and their parent's — in one go. Logins are issued by the same
 * services as the profile's buttons; if one cannot be issued (the email is
 * already used, say) the student is still added and the message says how to
 * finish from the profile.
 */
export async function createStudentAction(_p: CreateStudentResult, formData: FormData): Promise<CreateStudentResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const studentId = await createStudent(ctx, parseFormData(createStudentSchema, formData));
      const logins = parseFormData(loginStepSchema, formData);
      const credentialsList: Credentials[] = [];
      const problems: string[] = [];

      if (logins.studentLoginEmail) {
        try {
          credentialsList.push(await grantStudentPortal(ctx, studentId, logins.studentLoginEmail));
        } catch (error) {
          problems.push(`The student's login wasn't created (${error instanceof AppError ? error.message : "please try again"}).`);
        }
      }
      if (logins.parentLogin) {
        const link = await ctx.db.parentStudent.findFirst({
          where: { studentId },
          orderBy: { isPrimary: "desc" },
          select: { parent: { select: { id: true, email: true, userId: true } } },
        });
        if (link?.parent.userId) {
          // A sibling's parent who already signs in sees this child too.
        } else if (link?.parent.email) {
          try {
            credentialsList.push(await grantParentPortal(ctx, link.parent.id, link.parent.email));
          } catch (error) {
            problems.push(`The parent's login wasn't created (${error instanceof AppError ? error.message : "please try again"}).`);
          }
        } else {
          problems.push("The parent's login wasn't created because they have no email address.");
        }
      }

      const message = ["Student added successfully.", ...problems, problems.length ? "You can create logins from the student's profile." : ""].filter(Boolean).join(" ");
      // With passwords to hand over, stay here and show them once; otherwise
      // go straight to the new student's profile.
      return successResult(message, {
        studentId,
        ...(credentialsList.length || problems.length
          ? { credentialsList, next: { href: `/school-admin/students/${studentId}`, label: "Open the student's profile" } }
          : {}),
      });
    },
    {
      revalidate: REVALIDATE,
      redirectTo: (data) => (data.credentialsList ? null : (`/school-admin/students/${data.studentId}` as Route)),
    },
  );
}

export async function updateStudentAction(
  _p: ActionResult<{ studentId: string }>,
  formData: FormData,
): Promise<ActionResult<{ studentId: string }>> {
  return performAction(
    async () => {
      const ctx = await admin();
      const input = parseFormData(updateStudentSchema, formData);
      await updateStudent(ctx, input);
      return successResult("Student saved.", { studentId: input.studentId });
    },
    { revalidate: REVALIDATE, redirectTo: ({ studentId }) => `/school-admin/students/${studentId}` as Route },
  );
}

const studentIdSchema = z.object({ studentId: id });

/**
 * Erase a student admitted by mistake.
 *
 * Refused once they have a register, a remark or a result behind them, so this
 * cannot be a way to lose a child's year — see `deleteStudent`.
 */
export async function deleteStudentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { studentId } = parseFormData(studentIdSchema, formData);
      await deleteStudent(ctx, studentId);
      return successResult("Student deleted.");
    },
    // The page it was pressed on no longer exists.
    { revalidate: REVALIDATE, redirectTo: "/school-admin/students" },
  );
}

export async function enrollStudentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await enrollStudent(ctx, parseFormData(enrollmentSchema, formData));
      return successResult("Placement saved.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function linkGuardianAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await linkGuardian(ctx, parseFormData(linkGuardianSchema, formData));
      return successResult("Parent linked.");
    },
    { revalidate: REVALIDATE },
  );
}

const linkIdSchema = z.object({ linkId: id });

export async function unlinkGuardianAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { linkId } = parseFormData(linkIdSchema, formData);
      await unlinkGuardian(ctx, linkId);
      return successResult("Parent unlinked.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function updateParentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await updateParent(ctx, parseFormData(updateParentSchema, formData));
      return successResult("Parent saved.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function grantStudentPortalAction(_p: CredentialsResult, formData: FormData): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { personId, email } = parseFormData(portalAccessSchema, formData);
      const credentials = await grantStudentPortal(ctx, personId, email);
      return successResult("Student login created.", { credentials });
    },
    { revalidate: REVALIDATE },
  );
}

export async function grantParentPortalAction(_p: CredentialsResult, formData: FormData): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { personId, email } = parseFormData(portalAccessSchema, formData);
      const credentials = await grantParentPortal(ctx, personId, email);
      return successResult("Parent login created.", { credentials });
    },
    { revalidate: REVALIDATE },
  );
}

const userIdSchema = z.object({ userId: id });

export async function resetPortalPasswordAction(_p: CredentialsResult, formData: FormData): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { userId } = parseFormData(userIdSchema, formData);
      const credentials = await resetPortalPassword(ctx, userId);
      return successResult("New password issued.", { credentials });
    },
    { revalidate: REVALIDATE },
  );
}

// -----------------------------------------------------------------------------
// Teachers
// -----------------------------------------------------------------------------

export async function createTeacherAction(
  _p: ActionResult<{ teacherId?: string; credentials?: Credentials }>,
  formData: FormData,
): Promise<ActionResult<{ teacherId?: string; credentials?: Credentials }>> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { teacherId, credentials } = await createTeacher(ctx, parseFormData(createTeacherSchema, formData));
      return successResult("Teacher added. Share the sign-in below.", { teacherId, credentials });
    },
    { revalidate: REVALIDATE },
  );
}

export async function updateTeacherAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await updateTeacher(ctx, parseFormData(updateTeacherSchema, formData));
      return successResult("Teacher saved.");
    },
    { revalidate: REVALIDATE },
  );
}

const teacherIdSchema = z.object({ teacherId: id });

/**
 * Erase a teacher added by mistake.
 *
 * Refused outright once they have a record in the school, so the button this
 * sits behind is not a way to lose history — see `deleteTeacher`.
 */
export async function deleteTeacherAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { teacherId } = parseFormData(teacherIdSchema, formData);
      await deleteTeacher(ctx, teacherId);
      return successResult("Teacher deleted.");
    },
    // The page it was pressed on no longer exists.
    { revalidate: REVALIDATE, redirectTo: "/school-admin/teachers" },
  );
}

export async function assignSubjectAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const input = parseFormData(assignmentSchema, formData);
      const sectionId = await resolveSectionChoice(ctx, input.sectionId);
      await assignSubject(ctx, { ...input, sectionId });
      return successResult("Subject assigned.");
    },
    { revalidate: REVALIDATE },
  );
}

const assignmentIdSchema = z.object({ assignmentId: id });

export async function unassignSubjectAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { assignmentId } = parseFormData(assignmentIdSchema, formData);
      await unassignSubject(ctx, assignmentId);
      return successResult("Assignment removed.");
    },
    { revalidate: REVALIDATE },
  );
}
