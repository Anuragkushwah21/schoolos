/**
 * The accountant runs the school's accounts — and so does the School Admin.
 *
 *   * A hired accountant can, by default: collect fees, add and remove
 *     expenses (a gadget bought is an Equipment expense), pay salaries and see
 *     the reports. Salary structures stay with the School Admin.
 *   * The School Admin keeps all of it, accountant or not.
 *   * An accountant still on an older default (never customised) moves to the
 *     full accounts responsibilities, audited; one the admin set by hand is
 *     never widened.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dateOnly, today } from "@/lib/dates";
import { ForbiddenError } from "@/lib/errors";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { staffGrants } from "@/server/auth/staff-access";
import { prisma } from "@/server/db/prisma";
import { listExpenses, recordExpense, removeExpense } from "@/server/finance/expenses";
import { chargeStudent, createFeeHead, recordPayment } from "@/server/finance/fees";
import { payPayroll } from "@/server/finance/payroll";
import { setSalary } from "@/server/finance/salary";
import { setStaffGrants } from "@/server/operations/staff";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

async function accountant(key: string, grants: string[], customised = false): Promise<{ id: string; ctx: TenantContext }> {
  const user = await prisma.user.create({ data: { email: `${key}@acc-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Gupta", schoolId: schoolA.schoolId } });
  const staff = await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Gupta", role: "ACCOUNTANT", grants, grantsCustomized: customised } });
  return { id: staff.id, ctx: contextFor(schoolA, user.id, "NON_TEACHING_STAFF") };
}

const expense = (extra: Record<string, unknown> = {}) =>
  ({ category: "EQUIPMENT", description: "Projector for Class 10-A", amountMinor: 32_000_00, spentOn: today(), method: "BANK_TRANSFER", reference: null, notes: null, ...extra }) as Parameters<typeof recordExpense>[1];
const lastMonth = () => {
  const now = today();
  return dateOnly(now.getUTCFullYear(), now.getUTCMonth(), 1);
};

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // A payment is taken against a fee: both students owe one.
  const head = await createFeeHead(adminOf(schoolA), { name: "Tuition (accounts test)", note: null });
  for (const studentId of schoolA.studentIds.slice(0, 2)) await chargeStudent(adminOf(schoolA), { studentId, feeHeadId: head.id, amountMinor: 10_000_00, dueOn: today(), notes: null });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("a hired accountant runs the accounts", () => {
  it("collects fees, records a gadget purchase and other expenses, removes one, and pays salaries", async () => {
    const acc = await accountant("acc-full", STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    await recordPayment(acc.ctx, { studentId: schoolA.studentIds[0]!, amountMinor: 5_000_00, paidOn: today(), method: "CASH", notes: null, receiptNo: "ACC-T-1" });
    const gadget = await recordExpense(acc.ctx, expense());
    const wrong = await recordExpense(acc.ctx, expense({ category: "STATIONERY", description: "Entered twice", amountMinor: 500_00 }));
    await removeExpense(acc.ctx, wrong.id);
    const rows = await listExpenses(acc.ctx, {});
    expect(rows.map((row) => row.id)).toContain(gadget.id);
    expect(rows.map((row) => row.id)).not.toContain(wrong.id);

    await setSalary(adminOf(schoolA), { teacherId: schoolA.teacherId, salaryType: "MONTHLY", amountMinor: 30_000_00, allowancesMinor: 0, deductionsMinor: 0, effectiveFrom: dateOnly(2025, 4, 1), notes: null });
    await expect(payPayroll(acc.ctx, { month: lastMonth(), paidOn: today(), method: "BANK_TRANSFER", reference: null, entries: [{ teacherId: schoolA.teacherId, amountMinor: 30_000_00 }] })).resolves.toMatchObject({ paid: 1 });
    // Setting what someone earns stays with the School Admin.
    await expect(setSalary(acc.ctx, { teacherId: schoolA.teacherId, salaryType: "MONTHLY", amountMinor: 99_000_00, allowancesMinor: 0, deductionsMinor: 0, effectiveFrom: dateOnly(2025, 5, 1), notes: null })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the School Admin keeps every bit of it, accountant or not", async () => {
    const admin = adminOf(schoolA);
    const row = await recordExpense(admin, expense({ description: "Printer" }));
    await removeExpense(admin, row.id);
    await recordPayment(admin, { studentId: schoolA.studentIds[1]!, amountMinor: 1_000_00, paidOn: today(), method: "UPI", notes: null, receiptNo: "ACC-T-2" });
    await expect(listExpenses(admin, {})).resolves.toBeInstanceOf(Array);
  });
});

describe("responsibilities follow the role unless the admin chose otherwise", () => {
  it("an accountant on an older default, never customised, gets the full accounts responsibilities — audited", async () => {
    const old = await accountant("acc-old", ["fees.view", "fees.collect"]);
    const grants = await staffGrants(old.ctx);
    expect([...grants].sort()).toEqual([...STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT].sort());
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: old.id } })).grants.sort()).toEqual([...STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT].sort());
    const audit = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, entityId: old.id, action: "STAFF_PERMISSION_ADDED" } });
    expect(audit?.summary).toMatch(/updated default responsibilities/);
    await expect(recordExpense(old.ctx, expense({ description: "Router" }))).resolves.toHaveProperty("id");
  });

  it("an accountant the admin limited by hand stays limited", async () => {
    const limited = await accountant("acc-limited", STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    await setStaffGrants(adminOf(schoolA), limited.id, ["fees.view", "fees.collect"]);
    expect([...(await staffGrants(limited.ctx))].sort()).toEqual(["fees.collect", "fees.view"]);
    await expect(recordExpense(limited.ctx, expense())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payPayroll(limited.ctx, { month: lastMonth(), paidOn: today(), method: "CASH", reference: null, entries: [{ teacherId: schoolA.teacherId, amountMinor: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("another school's admin sees none of these accounts", async () => {
    const rows = await listExpenses(adminOf(schoolB), {});
    expect(rows.some((row) => /Projector|Router/.test(row.description))).toBe(false);
  });
});
