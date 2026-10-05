"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { checkbox, id, optionalId, optionalText, requiredDate, requiredText } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import { carryForward, carryForwardAll } from "@/server/finance/carry-forward";
import { grantConcession, revokeConcession } from "@/server/finance/concessions";
import { recordFamilyPayment, setFamilyPaymentEnabled, voidFamilyPayment } from "@/server/finance/family";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;
const PAGES = ["/school-admin", "/staff", "/parent"];
const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const rupeesText = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN")}`;

const concessionSchema = z.object({
  chargeId: id,
  kind: z.enum(["FIXED", "PERCENT"]),
  amountRupees: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().min(0).max(10_000_000).optional()),
  percent: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().min(0).max(100).optional()),
  reason: requiredText("the reason for the concession", 300),
});

export async function grantConcessionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { discountMinor, netMinor } = await grantConcession(await admin(), parseFormData(concessionSchema, formData));
    return successResult(`Concession of ${rupeesText(discountMinor)} given. Net payable ${rupeesText(netMinor)}.`);
  }, { revalidate: PAGES });
}

export async function revokeConcessionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { concessionId } = parseFormData(z.object({ concessionId: id }), formData);
    await revokeConcession(await admin(), concessionId, "Withdrawn by the office");
    return successResult("Concession withdrawn. The full fee applies again.");
  }, { revalidate: PAGES });
}

export async function carryForwardAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { studentId, fromSessionId } = parseFormData(z.object({ studentId: id, fromSessionId: id }), formData);
    const { amountMinor } = await carryForward(await admin(), studentId, fromSessionId);
    return successResult(`${rupeesText(amountMinor)} carried forward as "Previous outstanding".`);
  }, { revalidate: PAGES });
}

export async function carryForwardAllAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { sectionId } = parseFormData(z.object({ sectionId: optionalId }), formData);
    const result = await carryForwardAll(await admin(), { sectionId: sectionId ?? undefined });
    return successResult(`${rupeesText(result.amountMinor)} carried forward for ${result.students} student${result.students === 1 ? "" : "s"}.${result.skipped.length ? ` Skipped: ${result.skipped.join(", ")}.` : ""}`);
  }, { revalidate: PAGES });
}

export async function setFamilyPaymentEnabledAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { enabled } = parseFormData(z.object({ enabled: checkbox }), formData);
    await setFamilyPaymentEnabled(await admin(), enabled);
    return successResult(enabled ? "Family payments switched on." : "Family payments switched off.");
  }, { revalidate: PAGES });
}

const familyPaymentSchema = z.object({
  parentId: id,
  paidOn: requiredDate("the payment date"),
  method: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "CARD", "OTHER"]),
  referenceNo: optionalText(60),
  notes: optionalText(300),
  back: z.enum(["/school-admin/finance/family", "/staff/fees/family"]),
});

/** One family payment, split per child. Amounts arrive as `amount:<studentId>` in rupees. */
export async function recordFamilyPaymentAction(_p: ActionResult<{ id: string; back: string } | undefined>, formData: FormData): Promise<ActionResult<{ id: string; back: string } | undefined>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF");
      const input = parseFormData(familyPaymentSchema, formData);
      const allocations: Array<{ studentId: string; amountMinor: number }> = [];
      const errors: Record<string, string[]> = {};
      for (const [key, value] of formData.entries()) {
        if (!key.startsWith("amount:")) continue;
        const raw = String(value).trim();
        if (!raw) continue;
        const rupees = Number(raw);
        if (!Number.isFinite(rupees) || rupees < 0) errors[key] = ["Enter an amount in rupees"];
        else allocations.push({ studentId: key.slice("amount:".length), amountMinor: Math.round(rupees * 100) });
      }
      if (Object.keys(errors).length) throw new ValidationError("Some amounts need correcting.", errors);
      const result = await recordFamilyPayment(ctx, { ...input, allocations });
      return successResult(`Family payment ${result.receiptNo} recorded: ${rupeesText(result.totalMinor)}.`, { id: result.id, back: input.back });
    },
    { revalidate: PAGES, redirectTo: (data) => (data ? (`${data.back}/${data.id}` as Route) : null) },
  );
}

export async function voidFamilyPaymentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { familyPaymentId, reason } = parseFormData(z.object({ familyPaymentId: id, reason: requiredText("the reason", 200) }), formData);
    await voidFamilyPayment(await admin(), familyPaymentId, reason);
    return successResult("Family payment voided — every child's share with it.");
  }, { revalidate: PAGES });
}
