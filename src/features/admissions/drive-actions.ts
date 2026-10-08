"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { checkbox, id, requiredText } from "@/lib/validation/common";
import { assignmentSchema, driveApplicationSchema, driveDecisionSchema, driveSchema, extendAssignmentSchema, reassignSchema } from "@/lib/validation/admission-drives";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  addAdmissionDocument,
  createDriveApplication,
  extendAssignment,
  reassignApplications,
  removeAdmissionDocument,
  removeAssignment,
  reviewDriveApplication,
  saveAssignment,
  saveDrive,
  setAssignmentPaused,
  submitDriveApplication,
  updateDriveApplication,
} from "@/server/admissions/drives";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;
type WithHref = ActionResult<{ href: Route } | undefined>;
const admin = () => requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL");
const teacher = () => requireTenantForAction("TEACHER");
const revalidate = ["/school-admin/admissions", "/teacher/admissions"];

// -----------------------------------------------------------------------------
// School Admin
// -----------------------------------------------------------------------------

export async function saveDriveAction(_p: WithHref, formData: FormData): Promise<WithHref> {
  return performAction(
    async () => {
      const input = parseFormData(driveSchema, formData);
      const driveId = await saveDrive(await admin(), input);
      return successResult(input.driveId ? "Drive saved." : "Drive created. Now assign classes to teachers.", { href: `/school-admin/admissions/drives/${driveId}` as Route });
    },
    { revalidate, redirectTo: (data) => (data ? data.href : null) },
  );
}

export async function saveAssignmentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(assignmentSchema, formData);
      await saveAssignment(await admin(), input);
      return successResult(input.assignmentId ? "Assignment updated." : "Teacher assigned.");
    },
    { revalidate },
  );
}

export async function extendAssignmentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await extendAssignment(await admin(), parseFormData(extendAssignmentSchema, formData));
      return successResult("Assignment extended.");
    },
    { revalidate },
  );
}

export async function pauseAssignmentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { assignmentId, paused } = parseFormData(z.object({ assignmentId: id, paused: checkbox }), formData);
      await setAssignmentPaused(await admin(), assignmentId, paused);
      return successResult(paused ? "Assignment paused. The teacher cannot add or change applications." : "Assignment resumed.");
    },
    { revalidate },
  );
}

export async function removeAssignmentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { assignmentId } = parseFormData(z.object({ assignmentId: id }), formData);
      await removeAssignment(await admin(), assignmentId);
      return successResult("Assignment removed. Its applications are kept.");
    },
    { revalidate },
  );
}

export async function reassignApplicationsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const moved = await reassignApplications(await admin(), parseFormData(reassignSchema, formData));
      return successResult(`${moved} application${moved === 1 ? "" : "s"} moved.`);
    },
    { revalidate },
  );
}

export async function reviewDriveApplicationAction(_p: WithHref, formData: FormData): Promise<WithHref> {
  return performAction(
    async () => {
      const input = parseFormData(driveDecisionSchema, formData);
      await reviewDriveApplication(await admin(), input);
      // Approved: straight on to the usual admission, already filled in.
      return input.decision === "APPROVE"
        ? successResult("Approved. Confirm the details to admit the student.", { href: `/school-admin/admissions/${input.applicationId}/convert` as Route })
        : successResult(input.decision === "REJECT" ? "Application rejected." : "Sent back to the teacher for correction.", undefined);
    },
    { revalidate, redirectTo: (data) => (data ? data.href : null) },
  );
}

// -----------------------------------------------------------------------------
// Teacher
// -----------------------------------------------------------------------------

export async function createDriveApplicationAction(_p: WithHref, formData: FormData): Promise<WithHref> {
  return performAction(
    async () => {
      const { assignmentId } = parseFormData(z.object({ assignmentId: id }), formData);
      const applicationId = await createDriveApplication(await teacher(), assignmentId, parseFormData(driveApplicationSchema, formData));
      return successResult("Application saved as a draft. Add documents, then submit it.", { href: `/teacher/admissions/${applicationId}` as Route });
    },
    { revalidate, redirectTo: (data) => (data ? data.href : null) },
  );
}

export async function updateDriveApplicationAction(_p: WithHref, formData: FormData): Promise<WithHref> {
  return performAction(
    async () => {
      const { applicationId } = parseFormData(z.object({ applicationId: id }), formData);
      await updateDriveApplication(await teacher(), applicationId, parseFormData(driveApplicationSchema, formData));
      return successResult("Application saved.", { href: `/teacher/admissions/${applicationId}` as Route });
    },
    { revalidate, redirectTo: (data) => (data ? data.href : null) },
  );
}

export async function submitDriveApplicationAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { applicationId } = parseFormData(z.object({ applicationId: id }), formData);
      await submitDriveApplication(await teacher(), applicationId);
      return successResult("Submitted. The School Admin will review it.");
    },
    { revalidate },
  );
}

export async function addAdmissionDocumentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { applicationId, label } = parseFormData(z.object({ applicationId: id, label: requiredText("what the document is", 80) }), formData);
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION", "Choose a PDF file to upload.");
      await addAdmissionDocument(await teacher(), { applicationId, label, file });
      return successResult("Document added.");
    },
    { revalidate },
  );
}

export async function removeAdmissionDocumentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { documentId } = parseFormData(z.object({ documentId: id }), formData);
      await removeAdmissionDocument(await teacher(), documentId);
      return successResult("Document removed.");
    },
    { revalidate },
  );
}
