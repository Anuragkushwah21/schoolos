/**
 * When the accountant pays a salary, the School Admin sees it.
 *
 *   * Payroll (and the admin dashboard, which reads the same) shows each
 *     payment with who recorded it — "Ravi Gupta (Accountant)" — and how much
 *     is still to pay this month, in rupees.
 *   * The audit log names each person paid, their role and amount, the date and
 *     method; the actor is the accountant.
 *   * A single salary payment is audited the same way.
 *   * Another school sees none of it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dateOnly, today } from "@/lib/dates";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { getPayroll, payPayroll } from "@/server/finance/payroll";
import { monthOf, paySalary, setSalary } from "@/server/finance/salary";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let accountant: { id: string; userId: string; ctx: TenantContext };
let alok: string;
let peon: string;
const month = monthOf(today());

async function staff(first: string, last: string, role: "ACCOUNTANT" | "DRIVER" | "PEON") {
  const user = await prisma.user.create({ data: { email: `${first.toLowerCase()}@salary-vis.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: first, lastName: last, schoolId: schoolA.schoolId } });
  const member = await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: `SV-${first}`, firstName: first, lastName: last, role, grants: STAFF_ROLE_DEFAULT_GRANTS[role] } });
  return { id: member.id, userId: user.id, ctx: contextFor(schoolA, user.id, "NON_TEACHING_STAFF") };
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  accountant = await staff("Ravi", "Gupta", "ACCOUNTANT");
  alok = (await staff("Alok", "Kumar", "DRIVER")).id;
  peon = (await staff("Mohan", "Lal", "PEON")).id;
  const admin = adminOf(schoolA);
  for (const [staffMemberId, amountMinor] of [[alok, 15_000_00], [peon, 10_000_00]] as const) {
    await setSalary(admin, { staffMemberId, salaryType: "MONTHLY", amountMinor, allowancesMinor: 0, deductionsMinor: 0, effectiveFrom: dateOnly(2025, 4, 1), notes: null } as Parameters<typeof setSalary>[1]);
  }
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the accountant pays Alok the driver", () => {
  it("the admin's payroll shows the payment, who recorded it, and what is still to pay", async () => {
    await payPayroll(accountant.ctx, { month, paidOn: today(), method: "BANK_TRANSFER", reference: "UTR123", entries: [{ staffMemberId: alok, amountMinor: 15_000_00 }] });

    const payroll = await getPayroll(adminOf(schoolA), month);
    const row = payroll.rows.find((entry) => entry.staffMemberId === alok)!;
    expect(row.role).toBe("Driver");
    expect(row.payment).toMatchObject({ amountMinor: 15_000_00, paidBy: "Ravi Gupta (Accountant)" });
    expect(payroll.totals.paidMinor).toBe(15_000_00);
    // Mohan (10,000) is still to pay; anyone without a structure adds nothing.
    expect(payroll.totals.remainingMinor).toBeGreaterThanOrEqual(10_000_00);
    expect(payroll.rows.find((entry) => entry.staffMemberId === peon)?.payment).toBeNull();
  });

  it("the audit log names Alok, his role and amount, the date and method — recorded by the accountant", async () => {
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, action: "PAYROLL_PAID" }, orderBy: { createdAt: "desc" } });
    expect(audit.actorId).toBe(accountant.userId);
    expect(audit.summary).toMatch(/Alok Kumar \(Driver\) ₹15,000/);
    expect(audit.summary).toMatch(/Bank transfer, ref UTR123/);
    expect(audit.metadata).toMatchObject({ payees: [{ name: "Alok Kumar (Driver)", amountMinor: 15_000_00 }] });
  });

  it("a single payment by the admin is shown as theirs and audited the same way", async () => {
    await paySalary(adminOf(schoolA), { staffMemberId: peon, amountMinor: 10_000_00, paidOn: today(), forMonth: month, method: "CASH", reference: null, notes: null } as Parameters<typeof paySalary>[1]);
    const payroll = await getPayroll(adminOf(schoolA), month);
    expect(payroll.rows.find((entry) => entry.staffMemberId === peon)?.payment?.paidBy).toMatch(/\(School Admin\)$/);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, action: "SALARY_PAID" }, orderBy: { createdAt: "desc" } });
    expect(audit.summary).toMatch(/₹10,000 salary for .+ paid to Mohan Lal.*\(Cash\)/);
  });

  it("another school sees none of it", async () => {
    const payroll = await getPayroll(adminOf(schoolB), month);
    expect(payroll.rows.some((row) => row.name.includes("Alok"))).toBe(false);
    expect(payroll.totals.paidMinor).toBe(0);
  });
});
