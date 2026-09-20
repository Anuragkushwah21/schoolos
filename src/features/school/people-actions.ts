"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
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
import { requireTenantForAction } from "@/server/auth/current-user";
import { resetPortalPassword } from "@/server/people/accounts";
import {
  createStudent,
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
  unassignSubject,
  updateTeacher,
} from "@/server/people/teachers";
import { performAction } from "@/server/perform-action";
import type { Credentials } from "@/server/platform/schools";

type Result = ActionResult<undefined>;
type CredentialsResult = ActionResult<{ credentials?: Credentials }>;

const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const REVALIDATE = "/admin";

// -----------------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------------

export async function createStudentAction(
  _p: ActionResult<{ studentId: string }>,
  formData: FormData,
): Promise<ActionResult<{ studentId: string }>> {
  return performAction(
    async () => {
      const ctx = await admin();
      const studentId = await createStudent(ctx, parseFormData(createStudentSchema, formData));
      return successResult("Student added.", { studentId });
    },
    { revalidate: REVALIDATE, redirectTo: ({ studentId }) => `/admin/students/${studentId}` },
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
    { revalidate: REVALIDATE, redirectTo: ({ studentId }) => `/admin/students/${studentId}` },
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
      return successResult("Guardian linked.");
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
      return successResult("Guardian unlinked.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function updateParentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await updateParent(ctx, parseFormData(updateParentSchema, formData));
      return successResult("Guardian saved.");
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
      return successResult("Guardian login created.", { credentials });
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

export async function assignSubjectAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await assignSubject(ctx, parseFormData(assignmentSchema, formData));
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
