"use server";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import {
  responsibilityCreateSchema,
  responsibilityIdSchema,
  responsibilityProgressSchema,
  responsibilityUpdateSchema,
} from "@/lib/validation/responsibilities";
import { requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";
import {
  cancelResponsibility,
  completeResponsibility,
  confirmResponsibility,
  createResponsibility,
  reopenResponsibility,
  startResponsibility,
  updateResponsibility,
  updateResponsibilityProgress,
} from "@/server/responsibilities/service";

type Result = ActionResult<undefined>;

const revalidate = [
  "/school-admin/responsibilities",
  "/school-admin/principal",
  "/principal/dashboard",
  "/teacher/responsibilities",
  "/teacher/dashboard",
  "/staff/responsibilities",
  "/staff/dashboard",
];
/** Assigning and reviewing: the School Admin or the Principal — the service checks the permission again. */
const lead = () => requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL");
/** Working on one's own: anyone who can be given a responsibility. */
const assignee = () => requireTenantForAction("TEACHER", "NON_TEACHING_STAFF", "PRINCIPAL");

export async function createResponsibilityAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(responsibilityCreateSchema, formData);
      await createResponsibility(await lead(), input);
      return successResult(`"${input.title}" assigned.`);
    },
    { revalidate },
  );
}

export async function updateResponsibilityAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await updateResponsibility(await lead(), parseFormData(responsibilityUpdateSchema, formData));
      return successResult("Saved.");
    },
    { revalidate },
  );
}

export async function cancelResponsibilityAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await cancelResponsibility(await lead(), parseFormData(responsibilityIdSchema, formData).responsibilityId);
      return successResult("Cancelled.");
    },
    { revalidate },
  );
}

export async function confirmResponsibilityAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await confirmResponsibility(await lead(), parseFormData(responsibilityIdSchema, formData).responsibilityId);
      return successResult("Confirmed as done.");
    },
    { revalidate },
  );
}

export async function reopenResponsibilityAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await reopenResponsibility(await lead(), parseFormData(responsibilityIdSchema, formData).responsibilityId);
      return successResult("Sent back to them.");
    },
    { revalidate },
  );
}

export async function startResponsibilityAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await startResponsibility(await assignee(), parseFormData(responsibilityIdSchema, formData).responsibilityId);
      return successResult("Started.");
    },
    { revalidate },
  );
}

export async function responsibilityProgressAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(responsibilityProgressSchema, formData);
      await updateResponsibilityProgress(await assignee(), input.responsibilityId, input.progressNote);
      return successResult("Progress saved.");
    },
    { revalidate },
  );
}

export async function completeResponsibilityAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await completeResponsibility(await assignee(), parseFormData(responsibilityIdSchema, formData).responsibilityId);
      return successResult("Marked completed.");
    },
    { revalidate },
  );
}
