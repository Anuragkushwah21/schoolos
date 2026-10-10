"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { installmentDates } from "@/lib/dates";
import { id, optionalText, requiredDate } from "@/lib/validation/common";
import {
  chargeSectionSchema,
  chargeStudentSchema,
  expenseSchema,
  feeHeadSchema,
  PAYMENT_METHODS,
  lateFeePolicySchema,
  paymentSchema,
  voidPaymentSchema,
  receiptSettingsSchema,
  salaryPaymentSchema,
  salarySchema,
} from "@/lib/validation/school";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  chargeSection,
  chargeStudent,
  createFeeHead,
  recordPayment,
  removeCharge,
  voidPayment,
  setFeeHeadActive,
} from "@/server/finance/fees";
import { recordExpense, removeExpense } from "@/server/finance/expenses";
import { payPayroll } from "@/server/finance/payroll";
import { saveReceiptSettings } from "@/server/finance/receipts";
import {
  parsePayeeKey,
  paySalary,
  removeSalary,
  removeSalaryPayment,
  setSalary,
} from "@/server/finance/salary";
import { applyLateFees, saveLateFeePolicy } from "@/server/finance/late-fees";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/**
 * The school's money, and what it pays its staff.
 *
 * Every action re-checks its own caller: a Server Action is a separate POST
 * endpoint, so the page that rendered the form protects nothing. The services
 * behind these assert `SCHOOL_ADMIN` again, which is what makes a forged request
 * from a parent or a teacher fail rather than merely being unreachable.
 */

const admin = () => requireTenantForAction("SCHOOL_ADMIN");
/** The School Admin, or staff whose responsibility it is (fees.manage…) — the service checks which. */
const accounts = () => requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF");

// A salary change alters what the teacher's own screen shows, and a fee change
// alters the parent's and the student's, so all three areas are refreshed.
const FINANCE_PAGES = ["/school-admin", "/teacher", "/parent", "/student", "/staff"];

export async function setSalaryAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await setSalary(ctx, parseFormData(salarySchema, formData));
      return successResult("Salary recorded.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function removeSalaryAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { salaryId } = parseFormData(z.object({ salaryId: id }), formData);
      await removeSalary(ctx, salaryId);
      return successResult("Salary record removed.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function createFeeHeadAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await accounts();
      await createFeeHead(ctx, parseFormData(feeHeadSchema, formData));
      return successResult("Fee head added.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function setFeeHeadActiveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await accounts();
      const { feeHeadId, isActive } = parseFormData(
        z.object({ feeHeadId: id, isActive: z.coerce.boolean() }),
        formData,
      );
      await setFeeHeadActive(ctx, feeHeadId, isActive);
      return successResult(isActive ? "Fee head reactivated." : "Fee head deactivated.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function chargeStudentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await accounts();
      const { installmentCount, installmentEveryMonths, ...input } = parseFormData(chargeStudentSchema, formData);
      await chargeStudent(ctx, { ...input, installments: installmentDates(input.dueOn, installmentCount, installmentEveryMonths) });
      return successResult("Charge saved.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function chargeSectionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await accounts();
      const { installmentCount, installmentEveryMonths, ...input } = parseFormData(chargeSectionSchema, formData);
      const { charged, skipped } = await chargeSection(ctx, { ...input, installments: installmentDates(input.dueOn, installmentCount, installmentEveryMonths) });
      return successResult(`${charged === 1 ? "Charged 1 student." : `Charged ${charged} students.`}${skipped ? ` ${skipped} already had this fee and ${skipped === 1 ? "was" : "were"} left unchanged — correct ${skipped === 1 ? "that student" : "them"} one by one.` : ""}`);
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function removeChargeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await accounts();
      const { chargeId } = parseFormData(z.object({ chargeId: id }), formData);
      await removeCharge(ctx, chargeId);
      return successResult("Charge removed.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

/**
 * After a payment the office nearly always hands over a receipt, so the page
 * reopens on the same student with the new receipt ready to view or print.
 */
export async function recordPaymentAction(
  _p: ActionResult<{ paymentId: string; studentId: string; desk: string } | undefined>,
  formData: FormData,
): Promise<ActionResult<{ paymentId: string; studentId: string; desk: string } | undefined>> {
  return performAction(
    async () => {
      // The fee desk: the School Admin, or staff holding "Collect fees" (checked in the service).
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF");
      const input = parseFormData(paymentSchema, formData);
      const { id, duplicate } = await recordPayment(ctx, input);
      if (duplicate) {
        const desk = ctx.user.role === "SCHOOL_ADMIN" ? "/school-admin/finance/payments" : "/staff/fees";
        return successResult("This payment was already recorded — nothing was taken twice.", { paymentId: id, studentId: input.studentId, desk });
      }
      const desk = ctx.user.role === "SCHOOL_ADMIN" ? "/school-admin/finance/payments" : "/staff/fees";
      return successResult(`Fee payment recorded. Receipt ${input.receiptNo} is ready to print.`, { paymentId: id, studentId: input.studentId, desk });
    },
    {
      revalidate: [...FINANCE_PAGES, "/staff"],
      redirectTo: (data) => (data ? (`${data.desk}?student=${data.studentId}&receipt=${data.paymentId}` as Route) : null),
    },
  );
}

export async function saveReceiptSettingsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await saveReceiptSettings(ctx, parseFormData(receiptSettingsSchema, formData));
      return successResult("Receipt settings saved.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function removePaymentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await accounts();
      const { paymentId, reason } = parseFormData(voidPaymentSchema, formData);
      await voidPayment(ctx, paymentId, reason);
      return successResult("Receipt voided. It stays on record, marked void.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function recordExpenseAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      // The service checks the expenses permission for staff.
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF");
      await recordExpense(ctx, parseFormData(expenseSchema, formData));
      return successResult("Expense recorded.");
    },
    { revalidate: ["/school-admin", "/staff"] },
  );
}

export async function removeExpenseAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      // The service checks the expenses permission for staff.
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF");
      const { expenseId } = parseFormData(z.object({ expenseId: id }), formData);
      await removeExpense(ctx, expenseId);
      return successResult("Expense removed.");
    },
    { revalidate: ["/school-admin", "/staff"] },
  );
}

export async function paySalaryAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await paySalary(ctx, parseFormData(salaryPaymentSchema, formData));
      return successResult("Salary payment recorded.");
    },
    { revalidate: "/school-admin" },
  );
}

export async function removeSalaryPaymentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { paymentId } = parseFormData(z.object({ paymentId: id }), formData);
      await removeSalaryPayment(ctx, paymentId);
      return successResult("Salary payment removed.");
    },
    { revalidate: "/school-admin" },
  );
}

const payrollSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Choose the month"),
  paidOn: requiredDate("the date it was paid"),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(60),
});

/**
 * Pay the ticked teachers and staff for a month. Rows arrive as `pay` (ticked
 * "T:<id>" / "S:<id>" keys) and `amount:<key>` in rupees, which the admin may
 * have adjusted.
 */
export async function payPayrollAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      // The service checks "Record salary payments" for staff.
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF");
      const input = parseFormData(payrollSchema, formData);
      const ticked = formData.getAll("pay").map(String);
      const errors: Record<string, string[]> = {};
      // Each ticked row is "T:<teacherId>" or "S:<staffMemberId>".
      const entries = ticked.map((key) => {
        const raw = String(formData.get(`amount:${key}`) ?? "").trim();
        if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) errors[`amount:${key}`] = ["Enter an amount"];
        return { ...parsePayeeKey(key), amountMinor: Math.round(Number(raw) * 100) };
      });
      if (Object.keys(errors).length) throw new ValidationError("Some amounts need correcting.", errors);
      const [year, month] = input.month.split("-").map(Number) as [number, number];
      const { paid, totalMinor } = await payPayroll(ctx, {
        month: new Date(Date.UTC(year, month - 1, 1)),
        paidOn: input.paidOn,
        method: input.method,
        reference: input.reference,
        entries,
      });
      return successResult(`${paid} ${paid === 1 ? "person" : "people"} paid, ₹${(totalMinor / 100).toLocaleString("en-IN")} in total.`);
    },
    { revalidate: FINANCE_PAGES },
  );
}

/** School Admin: the late-fee policy (amount per instalment, grace days). */
export async function saveLateFeePolicyAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const input = parseFormData(lateFeePolicySchema, formData);
      await saveLateFeePolicy(ctx, { amountMinor: input.amountMinor, graceDays: input.graceDays });
      return successResult(input.amountMinor ? "Late fee policy saved." : "Late fees switched off.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

/** Add the late fee to every instalment unpaid past the grace period (once each). */
export async function applyLateFeesAction(_p: Result): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await accounts();
      const { added } = await applyLateFees(ctx);
      return successResult(added ? `Late fee added to ${added} overdue instalment${added === 1 ? "" : "s"}.` : "No new late fees — every overdue instalment already has one, or nothing is overdue.");
    },
    { revalidate: [...FINANCE_PAGES, "/staff"] },
  );
}
