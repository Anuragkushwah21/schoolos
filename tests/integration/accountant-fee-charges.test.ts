/**
 * A hired accountant raises the school's fee charges, not only collects them —
 * and the School Admin keeps all of it.
 *
 *   * By default the accountant adds fee heads, charges a whole class, adds a
 *     fee to one student who walks in to pay (so it shows for collection),
 *     collects it, removes a wrong charge, voids a wrong receipt and gives a
 *     concession.
 *   * An accountant on an older default (never customised) picks this up; one
 *     the admin limited by hand stays limited.
 *   * Every payment shows on the parent's dashboard (amount, date, receipt),
 *     and so does a receipt voided later.
 *   * The School Admin still does every bit of it; another school sees none.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError } from "@/lib/errors";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { staffGrants } from "@/server/auth/staff-access";
import { prisma } from "@/server/db/prisma";
import { grantConcession } from "@/server/finance/concessions";
import {
  chargeSection,
  chargeStudent,
  createFeeHead,
  listFeePositions,
  readStudentFees,
  recordPayment,
  removeCharge,
  setFeeHeadActive,
  voidPayment,
} from "@/server/finance/fees";
import { setStaffGrants } from "@/server/operations/staff";
import { getParentAlerts } from "@/server/parent/alerts";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

async function accountant(key: string, grants: string[]): Promise<{ id: string; ctx: TenantContext }> {
  const user = await prisma.user.create({ data: { email: `${key}@fee-charge-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Shah", schoolId: schoolA.schoolId } });
  const staff = await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Shah", role: "ACCOUNTANT", grants } });
  return { id: staff.id, ctx: contextFor(schoolA, user.id, "NON_TEACHING_STAFF") };
}

const due = () => addDays(today(), 30);
const chargesOf = async (ctx: TenantContext, studentId: string) => (await readStudentFees(ctx, studentId))!.charges;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("a hired accountant raises fee charges", () => {
  it("the accountant's default includes fee structure & charges and concessions", () => {
    expect(STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT).toEqual(expect.arrayContaining(["fees.manage", "fees.concessions"]));
  });

  it("adds a fee head and charges a whole class", async () => {
    const acc = await accountant("fc-class", STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    const head = await createFeeHead(acc.ctx, { name: "Tuition (accountant)", note: null });
    const { charged } = await chargeSection(acc.ctx, { sectionId: schoolA.sectionId, feeHeadId: head.id, amountMinor: 2_500_00, dueOn: due() });
    expect(charged).toBeGreaterThan(0);
    const positions = await listFeePositions(acc.ctx, { sectionId: schoolA.sectionId });
    expect(positions.rows.every((row) => row.summary.chargedMinor >= 2_500_00)).toBe(true);
    await setFeeHeadActive(acc.ctx, head.id, false);
    await setFeeHeadActive(acc.ctx, head.id, true);
  });

  it("a family walks in: the accountant adds the fee to that student, it shows as pending, and is collected", async () => {
    const acc = await accountant("fc-walkin", STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    const studentId = schoolA.studentIds[0]!;
    const head = await createFeeHead(acc.ctx, { name: "Exam fee (walk-in)", note: null });
    const before = (await readStudentFees(acc.ctx, studentId))!.summary.pendingMinor;

    await chargeStudent(acc.ctx, { studentId, feeHeadId: head.id, amountMinor: 800_00, dueOn: today(), notes: "Paid at the desk" });
    const pending = (await readStudentFees(acc.ctx, studentId))!.summary.pendingMinor;
    expect(pending - before).toBe(800_00);

    await recordPayment(acc.ctx, { studentId, amountMinor: 800_00, paidOn: today(), method: "CASH", notes: null, receiptNo: "FC-T-1" });
    expect((await readStudentFees(acc.ctx, studentId))!.summary.pendingMinor).toBe(before);
    // The family is told on their dashboard: how much, which date, which receipt.
    const parent = contextFor(schoolA, schoolA.parentUserId, "PARENT");
    const paid = (await getParentAlerts(parent)).find((alert) => alert.kind === "fee-paid" && alert.detail.includes("FC-T-1"));
    expect(paid?.title).toMatch(/800.*fees received/);
    expect(paid?.detail).toMatch(/Paid on .*\(Cash\)/);
    expect(paid?.childId).toBe(studentId);
  });

  it("a voided receipt tells the family it no longer counts; another family hears nothing", async () => {
    const acc = await accountant("fc-void-alert", STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    const studentId = schoolA.studentIds[0]!;
    const receipt = await recordPayment(acc.ctx, { studentId, amountMinor: 50_00, paidOn: today(), method: "UPI", notes: null, receiptNo: "FC-T-3" });
    await voidPayment(acc.ctx, receipt.id, "Entered twice");
    const parent = contextFor(schoolA, schoolA.parentUserId, "PARENT");
    const alerts = await getParentAlerts(parent);
    expect(alerts.some((alert) => alert.title.includes("Receipt FC-T-3 cancelled") && alert.detail.includes("Entered twice"))).toBe(true);
    const other = contextFor(schoolB, schoolB.parentUserId, "PARENT");
    expect(JSON.stringify(await getParentAlerts(other))).not.toContain("FC-T-");
  });

  it("removes a wrong charge, voids a wrong receipt and gives a concession", async () => {
    const acc = await accountant("fc-fix", STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    const studentId = schoolA.studentIds[1]!;
    const wrongHead = await createFeeHead(acc.ctx, { name: "Charged by mistake", note: null });
    const wrong = await chargeStudent(acc.ctx, { studentId, feeHeadId: wrongHead.id, amountMinor: 300_00, dueOn: due(), notes: null });
    await removeCharge(acc.ctx, wrong.id);
    expect((await chargesOf(acc.ctx, studentId)).map((charge) => charge.id)).not.toContain(wrong.id);

    const receipt = await recordPayment(acc.ctx, { studentId, amountMinor: 100_00, paidOn: today(), method: "CASH", notes: null, receiptNo: "FC-T-2" });
    await voidPayment(acc.ctx, receipt.id, "Entered by mistake");
    expect((await prisma.feePayment.findUniqueOrThrow({ where: { id: receipt.id } })).voidedAt).not.toBeNull();

    const head = await createFeeHead(acc.ctx, { name: "Transport (concession)", note: null });
    const charge = await chargeStudent(acc.ctx, { studentId, feeHeadId: head.id, amountMinor: 1_000_00, dueOn: due(), notes: null });
    await expect(grantConcession(acc.ctx, { chargeId: charge.id, kind: "PERCENT", percent: 10, reason: "Sibling" })).resolves.toMatchObject({ discountMinor: 100_00 });
  });
});

describe("responsibilities follow the role unless the admin chose otherwise", () => {
  it("an accountant on the previous default, never customised, can now raise charges", async () => {
    const previous = STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT.filter((grant) => grant !== "fees.manage" && grant !== "fees.concessions");
    const old = await accountant("fc-old", previous);
    expect(await staffGrants(old.ctx)).toContain("fees.manage");
    await expect(createFeeHead(old.ctx, { name: "Lab fee (upgraded)", note: null })).resolves.toHaveProperty("id");
  });

  it("an accountant the admin limited to collecting stays limited", async () => {
    const limited = await accountant("fc-limited", STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    await setStaffGrants(adminOf(schoolA), limited.id, ["fees.view", "fees.collect"]);
    await expect(createFeeHead(limited.ctx, { name: "Not allowed", note: null })).rejects.toBeInstanceOf(ForbiddenError);
    const heads = await prisma.feeHead.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, isActive: true } });
    await expect(chargeStudent(limited.ctx, { studentId: schoolA.studentIds[0]!, feeHeadId: heads.id, amountMinor: 1_00, dueOn: due(), notes: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(chargeSection(limited.ctx, { sectionId: schoolA.sectionId, feeHeadId: heads.id, amountMinor: 1_00, dueOn: due() })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the School Admin keeps all of it", async () => {
    const admin = adminOf(schoolA);
    const head = await createFeeHead(admin, { name: "Annual day (admin)", note: null });
    await chargeSection(admin, { sectionId: schoolA.sectionId, feeHeadId: head.id, amountMinor: 200_00, dueOn: due() });
    const one = await chargeStudent(admin, { studentId: schoolA.studentIds[0]!, feeHeadId: head.id, amountMinor: 250_00, dueOn: due(), notes: null });
    await removeCharge(admin, one.id);
  });

  it("another school sees none of School A's heads or charges", async () => {
    const heads = await prisma.feeHead.findMany({ where: { schoolId: schoolB.schoolId, name: { contains: "accountant" } } });
    expect(heads).toHaveLength(0);
    const fees = await listFeePositions(adminOf(schoolB));
    expect(JSON.stringify(fees)).not.toContain(schoolA.studentIds[0]!);
  });
});
