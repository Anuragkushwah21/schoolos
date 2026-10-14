"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { DOCUMENT_TYPES } from "@/lib/documents";
import { checkbox, id, optionalDate, optionalId, optionalText } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import { type BulkResult, approveDocument, bulkCreateDocuments, createDocument, rejectDocument, revokeDocument } from "@/server/documents/service";
import { saveDocumentSettings, saveSignature } from "@/server/documents/settings";
import { performAction } from "@/server/perform-action";

/**
 * Document Center actions. Each service checks the caller again — role,
 * document type, the person, the school — so these only parse forms.
 */

type Result = ActionResult<undefined>;
const PAGES = ["/school-admin/documents", "/school-admin/students", "/school-admin/teachers", "/school-admin/staff", "/school-admin/principal", "/school-admin/settings/documents"];
const LEADERS = ["SCHOOL_ADMIN", "PRINCIPAL"] as const;

const signatory = z.enum(["PRINCIPAL", "SCHOOL_ADMIN"]);

export async function saveDocumentSettingsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const input = parseFormData(z.object({ documentHeaderNote: optionalText(200), documentFooterNote: optionalText(300), adminSignatoryName: optionalText(120), adminSignatoryTitle: optionalText(80), certificateSignatory: signatory, employmentSignatory: signatory, tcApprovalRequired: checkbox }), formData);
      await saveDocumentSettings(ctx, input);
      return successResult("Document settings saved.");
    },
    { revalidate: PAGES },
  );
}

export async function saveSignatureAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { who, remove } = parseFormData(z.object({ who: signatory, remove: checkbox }), formData);
      const file = formData.get("file");
      await saveSignature(ctx, who, remove ? null : file instanceof File ? file : null);
      return successResult(remove ? "Signature removed." : "Signature saved.");
    },
    { revalidate: PAGES },
  );
}

const paramsSchema = {
  examId: optionalId,
  purpose: optionalText(160),
  conduct: optionalText(80),
  reason: optionalText(200),
  leavingDate: optionalDate,
  exitDate: optionalDate,
  admissionDate: optionalDate,
  duesCleared: checkbox,
  issuedOn: optionalDate,
};

const createSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  kind: z.enum(["STUDENT", "TEACHER", "STAFF", "PRINCIPAL"]),
  personId: id,
  requestKey: z.string().trim().min(8).max(80),
  reissue: checkbox,
  confirmed: checkbox,
  ...paramsSchema,
});

/** Generate or issue one document, then open it to print or save as PDF. */
export async function createDocumentAction(_p: ActionResult<{ id: string }>, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction(...LEADERS);
      const { type, kind, personId, requestKey, reissue, confirmed, ...params } = parseFormData(createSchema, formData);
      const made = await createDocument(ctx, { type, kind, personId, requestKey, reissue, confirmed, params });
      return successResult(made.number ? `Issued ${made.number}.` : type === "TRANSFER_CERTIFICATE" ? "Sent for approval. It gets its number when another leader approves it." : "Generated.", { id: made.id });
    },
    { revalidate: PAGES, redirectTo: (data) => `/documents/print?ids=${data.id}` as Route },
  );
}

export async function revokeDocumentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction(...LEADERS);
      const { documentId, reason } = parseFormData(z.object({ documentId: id, reason: z.string().trim().min(1, "Give a reason").max(300) }), formData);
      await revokeDocument(ctx, documentId, reason);
      return successResult("Document revoked. It stays on the register.");
    },
    { revalidate: PAGES },
  );
}

export async function approveDocumentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction(...LEADERS);
      const { documentId } = parseFormData(z.object({ documentId: id }), formData);
      const { number } = await approveDocument(ctx, documentId);
      return successResult(`Approved and issued as ${number}.`);
    },
    { revalidate: PAGES },
  );
}

export async function rejectDocumentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction(...LEADERS);
      const { documentId, reason } = parseFormData(z.object({ documentId: id, reason: z.string().trim().min(1, "Give a reason").max(300) }), formData);
      await rejectDocument(ctx, documentId, reason);
      return successResult("Not approved. It stays on the register with your reason.");
    },
    { revalidate: PAGES },
  );
}

const bulkSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  kind: z.enum(["STUDENT", "TEACHER", "STAFF", "PRINCIPAL"]),
  batchKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/),
  personIds: z.preprocess((value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]), z.array(id).min(1, "Choose at least one").max(200, "Choose at most 200 at a time")),
  ...paramsSchema,
});

/** One document type for the selected people. Returns what was made and what was skipped, and why. */
export async function bulkDocumentsAction(_p: ActionResult<BulkResult>, formData: FormData): Promise<ActionResult<BulkResult>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction(...LEADERS);
      const { type, kind, batchKey, personIds, ...params } = parseFormData(bulkSchema, formData);
      const result = await bulkCreateDocuments(ctx, { type, kind, personIds, params, batchKey });
      return successResult(`Made ${result.created}${result.repeated ? `, already made ${result.repeated}` : ""}${result.skipped.length ? `, skipped ${result.skipped.length}` : ""}.`, result);
    },
    { revalidate: ["/school-admin/documents"] },
  );
}
