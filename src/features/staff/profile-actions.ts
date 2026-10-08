"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { id } from "@/lib/validation/common";
import { STAFF_DOCUMENT_TYPES, documentVerificationSchema, staffDocumentSchema, staffProfileSchema, staffRoleChangeSchema } from "@/lib/validation/staff-profile";
import { inviteMessage } from "@/server/auth/account-links";
import { requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";
import {
  type StaffDocumentUpload,
  addStaffDocument,
  archiveStaffDocument,
  changeStaffRole,
  createStaffProfile,
  restoreRoleDefaults,
  setDocumentVerification,
} from "@/server/staff/profiles";

type Result = ActionResult<undefined>;
const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const revalidate = ["/school-admin/staff", "/school-admin/audit", "/staff"];

/** The wizard's Create: documents arrive as doc.N.type / doc.N.label / doc.N.file. */
export async function createStaffProfileAction(_p: ActionResult<{ href: Route } | undefined>, formData: FormData): Promise<ActionResult<{ href: Route } | undefined>> {
  return performAction(
    async () => {
      const ctx = await admin();
      const input = parseFormData(staffProfileSchema, formData);
      const documents: StaffDocumentUpload[] = [];
      for (let index = 0; index < 12; index += 1) {
        const file = formData.get(`doc.${index}.file`);
        if (!(file instanceof File) || file.size === 0) continue;
        const type = String(formData.get(`doc.${index}.type`) ?? "");
        if (!(STAFF_DOCUMENT_TYPES as readonly string[]).includes(type)) throw new ValidationError("Please correct the highlighted fields.", { [`doc.${index}.type`]: ["Choose the document type"] });
        const label = String(formData.get(`doc.${index}.label`) ?? "").trim().slice(0, 80) || null;
        documents.push({ type: type as StaffDocumentUpload["type"], label, file });
      }
      const photo = formData.get("photo");
      const { staffId, invite } = await createStaffProfile(ctx, input, { photo: photo instanceof File ? photo : null, documents });
      return successResult(invite ? `Staff profile created. ${inviteMessage(invite)}` : "Staff profile created.", { href: `/school-admin/staff/${staffId}` as Route });
    },
    { revalidate, redirectTo: (data) => (data ? data.href : null) },
  );
}

export async function changeStaffRoleAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await changeStaffRole(await admin(), parseFormData(staffRoleChangeSchema, formData));
      return successResult("Role changed.");
    },
    { revalidate },
  );
}

export async function restoreRoleDefaultsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { staffId } = parseFormData(z.object({ staffId: id }), formData);
      await restoreRoleDefaults(await admin(), staffId);
      return successResult("Permissions restored to the role's defaults.");
    },
    { revalidate },
  );
}

export async function addStaffDocumentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(staffDocumentSchema, formData);
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) throw new ValidationError("Please correct the highlighted fields.", { file: ["Choose a file"] });
      await addStaffDocument(await admin(), { ...input, file });
      return successResult("Document uploaded.");
    },
    { revalidate },
  );
}

export async function setDocumentVerificationAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await setDocumentVerification(await admin(), parseFormData(documentVerificationSchema, formData));
      return successResult("Document status saved.");
    },
    { revalidate },
  );
}

export async function archiveStaffDocumentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { documentId } = parseFormData(z.object({ documentId: id }), formData);
      await archiveStaffDocument(await admin(), documentId);
      return successResult("Document removed from the record. It is kept in the history.");
    },
    { revalidate },
  );
}
