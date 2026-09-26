"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import {
  chargeSectionSchema,
  chargeStudentSchema,
  feeHeadSchema,
  paymentSchema,
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
import { removeSalary, setSalary } from "@/server/finance/salary";
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

export async function recordPaymentAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await recordPayment(ctx, parseFormData(paymentSchema, formData));
      return successResult("Payment recorded.");
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
