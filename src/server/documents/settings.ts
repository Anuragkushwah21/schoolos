import "server-only";

import { AppError, ForbiddenError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";
import { deleteStoredFile, storeImage, validateImage } from "@/server/storage/files";

/**
 * Document settings, the School Admin's (`settings` EDIT): the header and
 * footer printed on documents, the School Admin / MD signatory, who signs
 * certificates and who signs employment documents, and approved signature
 * images. Signature images are private files under the school's own folder,
 * served only to school leaders — never a public URL. A signature image does
 * not by itself make a document authorised; issuing does, and the register
 * records who issued it.
 */

export async function documentSettings(ctx: TenantContext) {
  assertCan(ctx, "settings", "VIEW");
  const school = await ctx.db.school.findFirst({
    select: { name: true, logoUrl: true, addressLine: true, city: true, phone: true, email: true, principalName: true, documentHeaderNote: true, documentFooterNote: true, adminSignatoryName: true, adminSignatoryTitle: true, principalSignatureKey: true, adminSignatureKey: true, certificateSignatory: true, employmentSignatory: true, tcApprovalRequired: true },
  });
  if (!school) throw new ForbiddenError();
  const { principalSignatureKey, adminSignatureKey, ...rest } = school;
  return { ...rest, hasPrincipalSignature: Boolean(principalSignatureKey), hasAdminSignature: Boolean(adminSignatureKey) };
}

export type DocumentSettingsInput = {
  documentHeaderNote: string | null;
  documentFooterNote: string | null;
  adminSignatoryName: string | null;
  adminSignatoryTitle: string | null;
  certificateSignatory: "PRINCIPAL" | "SCHOOL_ADMIN";
  employmentSignatory: "PRINCIPAL" | "SCHOOL_ADMIN";
  tcApprovalRequired: boolean;
};

export async function saveDocumentSettings(ctx: TenantContext, input: DocumentSettingsInput): Promise<void> {
  assertCan(ctx, "settings", "EDIT");
  await ctx.db.school.update({ where: { id: ctx.schoolId }, data: input });
  await recordAudit({ action: "DOCUMENT_SETTINGS_CHANGED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Document settings saved: certificates signed by ${input.certificateSignatory === "PRINCIPAL" ? "the Principal" : "the School Admin"}, employment documents by ${input.employmentSignatory === "PRINCIPAL" ? "the Principal" : "the School Admin"}; transfer certificates ${input.tcApprovalRequired ? "need a second leader's approval" : "are issued directly"}.` });
}

/**
 * Replace (or, with no file, remove) a signature image. Documents already
 * issued keep the image they were issued with (its file is not deleted);
 * new documents use the new one.
 */
export async function saveSignature(ctx: TenantContext, who: "PRINCIPAL" | "SCHOOL_ADMIN", file: File | null): Promise<void> {
  assertCan(ctx, "settings", "EDIT");
  const field = who === "PRINCIPAL" ? "principalSignatureKey" : "adminSignatureKey";
  let key: string | null = null;
  if (file && file.size > 0) {
    const image = await validateImage(file);
    key = await storeImage(ctx.schoolId, image);
  }
  const previous = await ctx.db.school.findFirst({ select: { principalSignatureKey: true, adminSignatureKey: true } });
  await ctx.db.school.update({ where: { id: ctx.schoolId }, data: { [field]: key } });
  // An old image no issued document points at can go.
  const old = previous?.[field] ?? null;
  if (old && old !== key) {
    const used = await ctx.db.issuedDocument.count({ where: { params: { path: ["signatureKey"], equals: old } } });
    if (!used) await deleteStoredFile(old).catch(() => undefined);
  }
  await recordAudit({ action: "DOCUMENT_SETTINGS_CHANGED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${who === "PRINCIPAL" ? "Principal" : "School Admin"} signature image ${key ? "replaced" : "removed"}.` });
}

/** The current signature image's key, for the settings preview. School leaders only. */
export async function currentSignatureKey(ctx: TenantContext, who: "PRINCIPAL" | "SCHOOL_ADMIN"): Promise<string | null> {
  assertCan(ctx, "settings", "VIEW");
  const school = await ctx.db.school.findFirst({ select: { principalSignatureKey: true, adminSignatureKey: true } });
  const key = who === "PRINCIPAL" ? school?.principalSignatureKey : school?.adminSignatureKey;
  if (key && !key.startsWith(`${ctx.schoolId}/`)) throw new AppError("FORBIDDEN", "Not available.");
  return key ?? null;
}
