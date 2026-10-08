/**
 * Payroll for non-teaching staff, on the same salary and payment tables as
 * teachers.
 *
 *   * The School Admin sets a salary structure for any staff member
 *     (accountant, driver, security…); a raise is a new row, so the history
 *     stays. Teacher payroll works exactly as before.
 *   * The month's payroll lists teachers and staff together, with unpaid leave
 *     for both, and pays a mixed batch at once; nobody is paid twice.
 *   * An accountant sees payroll only with "View payroll & salaries" and pays
 *     only with "Record salary payments" — never by default, never the salary
 *     structure. Security and support staff can never hold either.
 *   * Every change is audited, without salary figures in the summary of a
 *     structure change. Another school sees nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dateOnly, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { getPayroll, payPayroll } from "@/server/finance/payroll";
import { getStaffSalary, listSalaries, setSalary } from "@/server/finance/salary";
import { setStaffGrants } from "@/server/operations/staff";
import { salaryPaymentsTable } from "@/server/reports/exports";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
type Person = { id: string; ctx: TenantContext };
let accountant: Person;
let driver: Person;
let security: Person;

const now = today();
// Last month: safely in the past, and payable.
const month = dateOnly(now.getUTCFullYear(), now.getUTCMonth(), 1);
const midMonth = dateOnly(month.getUTCFullYear(), month.getUTCMonth() + 1, 10);

async function addStaff(key: string, role: "ACCOUNTANT" | "DRIVER" | "SECURITY", grants: string[] = STAFF_ROLE_DEFAULT_GRANTS[role]): Promise<Person> {
  const user = await prisma.user.create({ data: { email: `${key}@pay-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Singh", schoolId: schoolA.schoolId } });
  const staff = await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Singh", role, grants } });
  return { id: staff.id, ctx: contextFor(schoolA, user.id, "NON_TEACHING_STAFF") };
}

const structure = (extra: Record<string, unknown>) =>
  ({ salaryType: "MONTHLY", amountMinor: 20_000_00, allowancesMinor: 2_000_00, deductionsMinor: 1_000_00, effectiveFrom: dateOnly(2025, 4, 1), notes: null, ...extra }) as Parameters<typeof setSalary>[1];

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  accountant = await addStaff("pay-acc", "ACCOUNTANT");
  driver = await addStaff("pay-drv", "DRIVER");
  security = await addStaff("pay-sec", "SECURITY");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("salary structure", () => {
  it("the School Admin sets one for staff and teachers; a raise keeps the history", async () => {
    const admin = adminOf(schoolA);
    await setSalary(admin, structure({ teacherId: schoolA.teacherId, amountMinor: 30_000_00 }));
    await setSalary(admin, structure({ staffMemberId: driver.id, amountMinor: 15_000_00, allowancesMinor: 0, deductionsMinor: 0 }));
    await setSalary(admin, structure({ staffMemberId: accountant.id }));
    await setSalary(admin, structure({ staffMemberId: accountant.id, amountMinor: 22_000_00, effectiveFrom: dateOnly(2025, 10, 1) }));

    const history = await getStaffSalary(admin, accountant.id);
    expect(history.history).toHaveLength(2);
    expect(history.current).toMatchObject({ amountMinor: 22_000_00, netMinor: 23_000_00 });

    const { rows } = await listSalaries(admin);
    expect(rows.find((row) => row.staffMemberId === driver.id)).toMatchObject({ role: "Driver", kind: "STAFF", current: { netMinor: 15_000_00 } });
    expect(rows.find((row) => row.teacherId === schoolA.teacherId)).toMatchObject({ role: "Teacher", current: { netMinor: 31_000_00 } });
    expect(rows.find((row) => row.staffMemberId === security.id)).toMatchObject({ current: null });
  });

  it("refuses a row for nobody, or for both, and another school's people", async () => {
    await expect(setSalary(adminOf(schoolA), structure({}))).rejects.toBeInstanceOf(Error);
    await expect(setSalary(adminOf(schoolA), structure({ teacherId: schoolA.teacherId, staffMemberId: driver.id }))).rejects.toBeInstanceOf(Error);
    await expect(setSalary(adminOf(schoolB), structure({ staffMemberId: driver.id }))).rejects.toBeInstanceOf(NotFoundError);
    // The database itself refuses a salary row naming nobody.
    await expect(
      prisma.teacherSalary.create({ data: { schoolId: schoolA.schoolId, salaryType: "MONTHLY", amountMinor: 1, effectiveFrom: dateOnly(2025, 1, 1) } }),
    ).rejects.toThrow();
  });
});

describe("monthly payroll", () => {
  it("lists teachers and staff with unpaid leave, and pays a mixed batch once", async () => {
    await prisma.leaveRequest.create({
      data: { schoolId: schoolA.schoolId, staffMemberId: driver.id, type: "UNPAID", startDate: midMonth, endDate: midMonth, reason: "Personal", status: "APPROVED" },
    });
    const payroll = await getPayroll(adminOf(schoolA), month);
    const driverRow = payroll.rows.find((row) => row.staffMemberId === driver.id)!;
    expect(driverRow).toMatchObject({ kind: "STAFF", role: "Driver", dueMinor: 15_000_00, payment: null });
    expect(driverRow.unpaidLeaveDays).toBeLessThanOrEqual(1);
    expect(payroll.rows.find((row) => row.teacherId === schoolA.teacherId)).toMatchObject({ dueMinor: 31_000_00 });

    const paid = await payPayroll(adminOf(schoolA), {
      month,
      paidOn: now,
      method: "BANK_TRANSFER",
      reference: "BATCH-1",
      entries: [
        { teacherId: schoolA.teacherId, amountMinor: 31_000_00 },
        { staffMemberId: driver.id, amountMinor: 14_500_00 },
      ],
    });
    expect(paid).toEqual({ paid: 2, totalMinor: 45_500_00 });
    await expect(payPayroll(adminOf(schoolA), { month, paidOn: now, method: "CASH", reference: null, entries: [{ staffMemberId: driver.id, amountMinor: 1 }] })).rejects.toBeInstanceOf(ConflictError);
    const after = await getPayroll(adminOf(schoolA), month);
    expect(after.rows.find((row) => row.staffMemberId === driver.id)!.payment).toMatchObject({ amountMinor: 14_500_00 });
    expect((await getStaffSalary(adminOf(schoolA), driver.id)).payments).toHaveLength(1);
  });

  it("the payroll report names staff and their type", async () => {
    const table = await salaryPaymentsTable(adminOf(schoolA), month, now);
    expect(table.rows.some((row) => row.includes("pay-drv Singh") && row.includes("Driver"))).toBe(true);
  });
});

describe("who may see and pay payroll", () => {
  it("an accountant sees and pays payroll by default (7 Oct 2026: the school's accounts are the accountant's work)", async () => {
    await expect(getPayroll(accountant.ctx, month)).resolves.toHaveProperty("rows");
    await expect(listSalaries(accountant.ctx)).resolves.toHaveProperty("rows");
  });

  it("view only with View payroll; paying only with Record salary payments; never the structure", async () => {
    // The admin can narrow one accountant to view-only.
    await setStaffGrants(adminOf(schoolA), accountant.id, STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT.filter((key) => key !== "payroll.pay"));
    await expect(getPayroll(accountant.ctx, month)).resolves.toHaveProperty("rows");
    const entry = { month, paidOn: now, method: "CASH" as const, reference: null, entries: [{ staffMemberId: accountant.id, amountMinor: 23_000_00 }] };
    await expect(payPayroll(accountant.ctx, entry)).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), accountant.id, STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    await expect(payPayroll(accountant.ctx, entry)).resolves.toMatchObject({ paid: 1 });
    await expect(setSalary(accountant.ctx, structure({ staffMemberId: accountant.id, amountMinor: 99_000_00 }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("security and support staff can never be given payroll", async () => {
    await expect(setStaffGrants(adminOf(schoolA), security.id, ["payroll.view"])).rejects.toBeInstanceOf(ValidationError);
    await expect(getPayroll(security.ctx, month)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("audit and isolation", () => {
  it("records every change; a structure change never shows the figure", async () => {
    const entries = await prisma.auditLog.findMany({ where: { schoolId: schoolA.schoolId, entityId: { in: [driver.id, accountant.id] } }, select: { action: true, summary: true, entityType: true } });
    expect(entries.some((row) => row.action === "STAFF_SALARY_SET" && row.entityType === "StaffMember" && !/₹|15,000/.test(row.summary))).toBe(true);
    // A batch is logged once, naming each person paid with role and amount (7 Oct 2026:
    // the School Admin asked to see who was paid what, and by whom).
    const batches = await prisma.auditLog.findMany({ where: { schoolId: schoolA.schoolId, action: "PAYROLL_PAID" }, select: { summary: true } });
    expect(batches.some((row) => /\(Teacher\) ₹/.test(row.summary) && /\(Driver\) ₹/.test(row.summary) && /in total/.test(row.summary))).toBe(true);
  });

  it("another school sees none of it", async () => {
    const payroll = await getPayroll(adminOf(schoolB), month);
    expect(payroll.rows.some((row) => row.staffMemberId === driver.id)).toBe(false);
    await expect(getStaffSalary(adminOf(schoolB), driver.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(payPayroll(adminOf(schoolB), { month, paidOn: now, method: "CASH", reference: null, entries: [{ staffMemberId: security.id, amountMinor: 1_00 }] })).rejects.toBeInstanceOf(NotFoundError);
  });
});
