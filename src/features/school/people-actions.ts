"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";

import { z } from "zod";

import { type ActionResult, errorResult, parseFormData, successResult } from "@/lib/action-result";
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
import type { PreviewImportResult } from "@/features/imports/preview-import-form";
import { importTeachers } from "@/server/people/teacher-import";
import { performAction } from "@/server/perform-action";
import { inviteMessage } from "@/server/auth/account-links";
import { emailMoveMessage } from "@/server/people/accounts";

type Result = ActionResult<undefined>;
type CredentialsResult = ActionResult<undefined>;

const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const REVALIDATE = "/school-admin";

// -----------------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------------

type CreateStudentResult = ActionResult<{
  studentId: string;
  admissionNumber: string;
  next?: { href: string; label: string };
}>;

/**
 * Admit a student. Logins follow the class: none for Nursery–5, an optional
 * student login for Class 6–12, and a parent login whenever the parent has
 * an email — each activated by the person from their email. The message says
 * what was sent, and what was not and why.
 */
export async function createStudentAction(_p: CreateStudentResult, formData: FormData): Promise<CreateStudentResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const result = await createStudent(ctx, parseFormData(createStudentSchema, formData));
      const message = [
        `Student added. Admission number ${result.admissionNumber}.`,
        ...result.invites.map((invite) => `${invite.label}: ${inviteMessage(invite)}`),
        ...result.notes,
      ].join(" ");
      return successResult(message, { studentId: result.studentId, admissionNumber: result.admissionNumber, next: { href: `/school-admin/students/${result.studentId}`, label: "Open the student's profile" } });
    },
    { revalidate: REVALIDATE },
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
      const move = await updateStudent(ctx, input);
      return successResult(`Student saved.${emailMoveMessage(move)}`, { studentId: input.studentId });
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
      const move = await updateParent(ctx, parseFormData(updateParentSchema, formData));
      return successResult(`Parent saved.${emailMoveMessage(move)}`);
    },
    { revalidate: REVALIDATE },
  );
}

export async function grantStudentPortalAction(_p: CredentialsResult, formData: FormData): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { personId, email } = parseFormData(portalAccessSchema, formData);
      const invite = await grantStudentPortal(ctx, personId, email);
      return successResult(`Student login created. ${inviteMessage(invite)}`);
    },
    { revalidate: REVALIDATE },
  );
}

export async function grantParentPortalAction(_p: CredentialsResult, formData: FormData): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { personId, email } = parseFormData(portalAccessSchema, formData);
      const invite = await grantParentPortal(ctx, personId, email);
      return successResult(`Parent login created. ${inviteMessage(invite)}`);
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
      const invite = await resetPortalPassword(ctx, userId);
      if (!invite.delivered) {
        // Shown as an error, but the recorded failure should still appear on the page.
        revalidatePath(REVALIDATE, "layout");
        return errorResult(`${invite.label} to ${invite.email} failed${invite.error ? ` — ${invite.error}` : ""}. The account is unchanged; try again once that is fixed.`);
      }
      return successResult(`${invite.label} sent ✓ to ${invite.email}. Any earlier link no longer works; they choose their own password from this one.`);
    },
    { revalidate: REVALIDATE },
  );
}

// -----------------------------------------------------------------------------
// Teachers
// -----------------------------------------------------------------------------

export async function createTeacherAction(
  _p: ActionResult<{ teacherId?: string }>,
  formData: FormData,
): Promise<ActionResult<{ teacherId?: string }>> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { teacherId, invite } = await createTeacher(ctx, parseFormData(createTeacherSchema, formData));
      return successResult(`Teacher added. ${inviteMessage(invite)}`, { teacherId });
    },
    { revalidate: REVALIDATE },
  );
}

export async function updateTeacherAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const move = await updateTeacher(ctx, parseFormData(updateTeacherSchema, formData));
      return successResult(`Teacher saved.${emailMoveMessage(move)}`);
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

/** "Check file" previews a teachers CSV; "Import valid records" adds the rows that passed, with logins. */
export async function importTeachersAction(_p: PreviewImportResult, formData: FormData): Promise<PreviewImportResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      if (formData.get("mode") === "cancel") return { status: "idle" };
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose the CSV file to import." };
      if (file.size > 500_000) return { status: "error", message: "The file is too large. Import at most 100 teachers at a time." };
      const mode = formData.get("mode") === "import" ? "import" : "check";
      const report = await importTeachers(ctx, await file.text(), { mode, validOnly: formData.get("validOnly") === "1" });
      const message =
        mode === "import" && report.created
          ? `${report.created} teacher${report.created === 1 ? "" : "s"} added. ${report.invites.filter((i) => i.delivered).length} activation email${report.invites.filter((i) => i.delivered).length === 1 ? "" : "s"} sent${report.invites.some((i) => !i.delivered) ? `; ${report.invites.filter((i) => !i.delivered).length} could not be sent — use "Send login email" on each teacher's page` : ""}.${report.total - report.created ? ` ${report.total - report.created} row(s) were left out.` : ""}`
          : undefined;
      return successResult(message, { ...report, mode });
    },
    { revalidate: REVALIDATE },
  );
}
