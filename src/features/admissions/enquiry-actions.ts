"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { checkbox, id } from "@/lib/validation/common";
import {
  admissionPortalSchema,
  applyConcessionsSchema,
  childFeeSchema,
  childStatusSchema,
  createEnquirySchema,
  enquiryFollowUpSchema,
  enquiryStatusSchema,
  familyFeeSchema,
  linkParentSchema,
  updateEnquirySchema,
} from "@/lib/validation/enquiries";
import { createStudentSchema } from "@/lib/validation/school";
import { inviteMessage } from "@/server/auth/account-links";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  addEnquiryFollowUp,
  applyDiscussedConcessions,
  convertEnquiryChild,
  createEnquiry,
  linkExistingParent,
  saveChildFee,
  saveFamilyFee,
  setChildWithdrawn,
  setEnquiryStatus,
  updateEnquiry,
} from "@/server/admissions/enquiries";
import { savePortalSettings, setPortalPublished } from "@/server/admissions/portal";
import { performAction } from "@/server/perform-action";

/** Family enquiries and the admission portal — School Admin only, on the server. */

type Result = ActionResult<undefined>;
const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const revalidate = ["/school-admin"];

export async function createEnquiryAction(_p: ActionResult<{ id: string } | undefined>, formData: FormData): Promise<ActionResult<{ id: string } | undefined>> {
  return performAction(
    async () => {
      const enquiryId = await createEnquiry(await admin(), parseFormData(createEnquirySchema, formData));
      return successResult("Enquiry saved.", { id: enquiryId });
    },
    { revalidate, redirectTo: (data) => (data ? (`/school-admin/admissions/enquiries/${data.id}` as Route) : null) },
  );
}

export async function updateEnquiryAction(_p: ActionResult<{ id: string } | undefined>, formData: FormData): Promise<ActionResult<{ id: string } | undefined>> {
  return performAction(
    async () => {
      const input = parseFormData(updateEnquirySchema, formData);
      await updateEnquiry(await admin(), input);
      return successResult("Enquiry updated.", { id: input.enquiryId });
    },
    { revalidate, redirectTo: (data) => (data ? (`/school-admin/admissions/enquiries/${data.id}` as Route) : null) },
  );
}

export async function saveChildFeeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await saveChildFee(await admin(), parseFormData(childFeeSchema, formData));
      return successResult("Fee discussion saved. This is not a fee — nothing is charged.");
    },
    { revalidate },
  );
}

export async function saveFamilyFeeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await saveFamilyFee(await admin(), parseFormData(familyFeeSchema, formData));
      return successResult("Family discussion saved.");
    },
    { revalidate },
  );
}

export async function addEnquiryFollowUpAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await addEnquiryFollowUp(await admin(), parseFormData(enquiryFollowUpSchema, formData));
      return successResult("Follow-up saved.");
    },
    { revalidate },
  );
}

export async function setEnquiryStatusAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(enquiryStatusSchema, formData);
      await setEnquiryStatus(await admin(), input);
      return successResult(input.status === "CLOSED" ? "Enquiry closed. It stays in the records." : "Status updated.");
    },
    { revalidate },
  );
}

export async function linkParentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(linkParentSchema, formData);
      await linkExistingParent(await admin(), input);
      return successResult(input.parentId ? "Existing parent linked — no second parent will be created." : "Parent unlinked.");
    },
    { revalidate },
  );
}

export async function setChildWithdrawnAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { childId, withdrawn } = parseFormData(childStatusSchema, formData);
      await setChildWithdrawn(await admin(), childId, withdrawn);
      return successResult(withdrawn ? "Marked not proceeding." : "Back in the enquiry.");
    },
    { revalidate },
  );
}

const convertSchema = z.object({
  enquiryId: id,
  childId: id,
  admissionType: z.enum(["NEW", "TRANSFER", "READMISSION"]).default("NEW"),
  confirmNotDuplicate: checkbox,
});

type ConvertResult = ActionResult<{ studentId: string; admissionNumber: string; next?: { href: string; label: string } }>;

/** Admit one child of the enquiry. Fees are untouched: an agreed discount is applied separately, on confirmation. */
export async function convertEnquiryChildAction(_p: ConvertResult, formData: FormData): Promise<ConvertResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { enquiryId, childId, admissionType, confirmNotDuplicate } = parseFormData(convertSchema, formData);
      const result = await convertEnquiryChild(ctx, { enquiryId, childId, student: parseFormData(createStudentSchema, formData), admissionType, confirmNotDuplicate });
      const message = [
        `Admitted. Admission number ${result.admissionNumber}.`,
        ...result.invites.map((invite) => `${invite.label}: ${inviteMessage(invite)}`),
        ...result.notes,
      ].join(" ");
      return successResult(message, {
        studentId: result.studentId,
        admissionNumber: result.admissionNumber,
        next: { href: `/school-admin/admissions/enquiries/${enquiryId}`, label: "Back to the family enquiry" },
      });
    },
    { revalidate: ["/school-admin", "/parent"] },
  );
}

/** "Apply discussed discount to actual fee records?" — confirmed, ticked children only. */
export async function applyConcessionsAction(_p: ActionResult<{ id: string } | undefined>, formData: FormData): Promise<ActionResult<{ id: string } | undefined>> {
  return performAction(
    async () => {
      const input = parseFormData(applyConcessionsSchema, formData);
      const items = input.apply.flatMap((row, formIndex) => (row.include ? [{ childId: row.childId, chargeId: row.chargeId ?? "", amountMinor: row.amount ?? 0, formIndex }] : []));
      const { applied } = await applyDiscussedConcessions(await admin(), { enquiryId: input.enquiryId, confirm: input.confirm, items });
      return successResult(`Applied to ${applied} ${applied === 1 ? "child's" : "children's"} fees. Each concession is on that child's own account.`, { id: input.enquiryId });
    },
    { revalidate: ["/school-admin", "/parent"], redirectTo: (data) => (data ? (`/school-admin/admissions/enquiries/${data.id}` as Route) : null) },
  );
}

/** Publish or unpublish the public admission form. */
export async function setPortalPublishedAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const isPublished = formData.get("isPublished") === "true";
      await setPortalPublished(await admin(), isPublished);
      return successResult(isPublished ? "Admission form published — parents can apply online." : "Admission form unpublished — the public page no longer takes applications.");
    },
    { revalidate: ["/school-admin", "/schools"] },
  );
}

export async function savePortalAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await savePortalSettings(await admin(), parseFormData(admissionPortalSchema, formData));
      return successResult("Admission page settings saved.");
    },
    { revalidate: ["/school-admin", "/schools"] },
  );
}
