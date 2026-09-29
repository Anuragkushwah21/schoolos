"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { bulkComplaintStatusSchema, handleComplaintSchema, raiseComplaintSchema } from "@/lib/validation/complaints";
import { requireTenantForAction } from "@/server/auth/current-user";
import { bulkComplaintStatus, closeMyComplaint, handleComplaint, raiseComplaint } from "@/server/communication/complaints";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;
const PAGES = ["/school-admin", "/teacher", "/parent", "/student"];

export async function raiseComplaintAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("PARENT", "STUDENT");
      await raiseComplaint(ctx, parseFormData(raiseComplaintSchema, formData));
      return successResult("Sent to the school office. You will see their response here.");
    },
    { revalidate: PAGES },
  );
}

export async function handleComplaintAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "TEACHER");
      await handleComplaint(ctx, parseFormData(handleComplaintSchema, formData));
      return successResult("Complaint updated.");
    },
    { revalidate: PAGES },
  );
}

export async function bulkComplaintStatusAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { updated } = await bulkComplaintStatus(ctx, parseFormData(bulkComplaintStatusSchema, formData));
      return successResult(`${updated} complaint${updated === 1 ? "" : "s"} updated.`);
    },
    { revalidate: PAGES },
  );
}

export async function closeMyComplaintAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("PARENT", "STUDENT");
      const { complaintId } = parseFormData(z.object({ complaintId: id }), formData);
      await closeMyComplaint(ctx, complaintId);
      return successResult("Complaint closed.");
    },
    { revalidate: PAGES },
  );
}
