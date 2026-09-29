"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { id, optionalText, requiredDate } from "@/lib/validation/common";
import {
  chargeSectionSchema,
  chargeStudentSchema,
  expenseSchema,
  feeHeadSchema,
  PAYMENT_METHODS,
  paymentSchema,
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
  removePayment,
  setFeeHeadActive,
} from "@/server/finance/fees";
import { recordExpense, removeExpense } from "@/server/finance/expenses";
import { payPayroll } from "@/server/finance/payroll";
import { saveReceiptSettings } from "@/server/finance/receipts";
import {
  paySalary,
  removeSalary,
  removeSalaryPayment,
  setSalary,
} from "@/server/finance/salary";
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

// A salary change alters what the teacher's own screen shows, and a fee change
// alters the parent's and the student's, so all three areas are refreshed.
const FINANCE_PAGES = ["/school-admin", "/teacher", "/parent", "/student"];

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
      const ctx = await admin();
      await createFeeHead(ctx, parseFormData(feeHeadSchema, formData));
      return successResult("Fee head added.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function setFeeHeadActiveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
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
      const ctx = await admin();
      await chargeStudent(ctx, parseFormData(chargeStudentSchema, formData));
      return successResult("Charge saved.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function chargeSectionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { charged } = await chargeSection(ctx, parseFormData(chargeSectionSchema, formData));
      return successResult(charged === 1 ? "Charged 1 student." : `Charged ${charged} students.`);
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function removeChargeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
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
  _p: ActionResult<{ paymentId: string; studentId: string } | undefined>,
  formData: FormData,
): Promise<ActionResult<{ paymentId: string; studentId: string } | undefined>> {
  return performAction(
    async () => {
      const ctx = await admin();
      const input = parseFormData(paymentSchema, formData);
      const { id } = await recordPayment(ctx, input);
      return successResult(`Fee payment recorded. Receipt ${input.receiptNo} is ready to print.`, { paymentId: id, studentId: input.studentId });
    },
    {
      revalidate: FINANCE_PAGES,
      redirectTo: (data) =>
        data
          ? (`/school-admin/finance/payments?student=${data.studentId}&receipt=${data.paymentId}` as Route)
          : null,
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
      const ctx = await admin();
      const { paymentId } = parseFormData(z.object({ paymentId: id }), formData);
      await removePayment(ctx, paymentId);
      return successResult("Payment removed.");
    },
    { revalidate: FINANCE_PAGES },
  );
}

export async function recordExpenseAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await recordExpense(ctx, parseFormData(expenseSchema, formData));
      return successResult("Expense recorded.");
    },
    { revalidate: "/school-admin" },
  );
}

export async function removeExpenseAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { expenseId } = parseFormData(z.object({ expenseId: id }), formData);
      await removeExpense(ctx, expenseId);
      return successResult("Expense removed.");
    },
    { revalidate: "/school-admin" },
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
 * Pay the ticked teachers for a month. Rows arrive as `pay` (ticked teacher
 * ids) and `amount:<teacherId>` in rupees, which the admin may have adjusted.
 */
export async function payPayrollAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const input = parseFormData(payrollSchema, formData);
      const ticked = formData.getAll("pay").map(String);
      const errors: Record<string, string[]> = {};
      const entries = ticked.map((teacherId) => {
        const raw = String(formData.get(`amount:${teacherId}`) ?? "").trim();
        if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) errors[`amount:${teacherId}`] = ["Enter an amount"];
        return { teacherId, amountMinor: Math.round(Number(raw) * 100) };
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
      return successResult(`${paid} teacher${paid === 1 ? "" : "s"} paid, ₹${(totalMinor / 100).toLocaleString("en-IN")} in total.`);
    },
    { revalidate: FINANCE_PAGES },
  );
}
