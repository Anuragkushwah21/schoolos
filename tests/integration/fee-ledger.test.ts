/**
 * Fees end to end: instalments, payments settling the earliest instalment
 * first, duplicate-safe payments, auditable voids, late fees, reports and the
 * ledger — and who may see what.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { classFeeSummary, overdueInstallments, studentLedger } from "@/server/finance/fee-reports";
import { chargeSection, chargeStudent, createFeeHead, readStudentFees, recordPayment, removeCharge, voidPayment } from "@/server/finance/fees";
import { applyLateFees, saveLateFeePolicy } from "@/server/finance/late-fees";
import { getChildFees, getChildLedger, getChildProfile } from "@/server/parent/child";
import { feeClassSummaryTable, feeLedgerTable } from "@/server/reports/exports";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let tuitionId: string;
const rs = (rupees: number) => rupees * 100;
const parentA = () => contextFor(schoolA, schoolA.parentUserId, "PARENT");
const parentB = () => contextFor(schoolB, schoolB.parentUserId, "PARENT");
const studentA = () => contextFor(schoolA, schoolA.studentUserId, "STUDENT");
let receiptNo = 0;
const nextReceipt = () => `LED-${++receiptNo}`;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const head = await createFeeHead(adminOf(schoolA), { name: "Tuition (ledger test)", note: null });
  tuitionId = head.id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("instalments and payments", () => {
  it("splits a class charge into instalments that add up exactly", async () => {
    const first = addDays(today(), -100);
    const dates = [first, addDays(first, 60), addDays(today(), 30)];
    await chargeSection(adminOf(schoolA), { sectionId: schoolA.sectionId, feeHeadId: tuitionId, amountMinor: rs(10_000), dueOn: first, installments: dates });
    const account = await readStudentFees(adminOf(schoolA), schoolA.studentIds[0]!);
    const tuition = account.charges.filter((row) => row.feeHead.id === tuitionId);
    expect(tuition.map((row) => row.installmentNo)).toEqual([1, 2, 3]);
    expect(tuition.reduce((sum, row) => sum + row.netMinor, 0)).toBe(rs(10_000));
    expect(tuition.map((row) => row.amountMinor)).toEqual([333_333, 333_333, 333_334]);
    // Two instalments are past due and nothing is paid.
    expect(account.summary).toMatchObject({ pendingMinor: rs(10_000), overdue: true });
  });

  it("a payment settles the earliest instalment first; overdue then means really unpaid", async () => {
    const studentId = schoolA.studentIds[0]!;
    await recordPayment(adminOf(schoolA), { studentId, amountMinor: 333_333, paidOn: today(), method: "CASH", notes: null, receiptNo: nextReceipt() });
    let account = await readStudentFees(adminOf(schoolA), studentId);
    let tuition = account.charges.filter((row) => row.feeHead.id === tuitionId);
    expect(tuition.map((row) => row.status)).toEqual(["PAID", "DUE", "DUE"]);
    expect(account.summary.overdue).toBe(true); // instalment 2 is past due

    await recordPayment(adminOf(schoolA), { studentId, amountMinor: 433_333, paidOn: today(), method: "UPI", notes: null, receiptNo: nextReceipt() });
    account = await readStudentFees(adminOf(schoolA), studentId);
    tuition = account.charges.filter((row) => row.feeHead.id === tuitionId);
    expect(tuition.map((row) => [row.status, row.remainingMinor])).toEqual([
      ["PAID", 0],
      ["PAID", 0],
      ["PARTIAL", 233_334],
    ]);
    // The only unpaid instalment is not due yet: nothing overdue.
    expect(account.summary).toMatchObject({ pendingMinor: 233_334, overdue: false, status: "PARTIAL" });
  });

  it("a double-submitted payment is recorded once; more than is owed is refused", async () => {
    const studentId = schoolA.studentIds[0]!;
    const key = "form-key-1";
    const first = await recordPayment(adminOf(schoolA), { studentId, amountMinor: rs(100), paidOn: today(), method: "CASH", notes: null, receiptNo: nextReceipt(), idempotencyKey: key });
    const again = await recordPayment(adminOf(schoolA), { studentId, amountMinor: rs(100), paidOn: today(), method: "CASH", notes: null, receiptNo: nextReceipt(), idempotencyKey: key });
    expect(again).toEqual({ id: first.id, duplicate: true });
    expect(await prisma.feePayment.count({ where: { idempotencyKey: key } })).toBe(1);

    const pending = (await readStudentFees(adminOf(schoolA), studentId)).summary.pendingMinor;
    await expect(recordPayment(adminOf(schoolA), { studentId, amountMinor: pending + 1, paidOn: today(), method: "CASH", notes: null, receiptNo: nextReceipt() })).rejects.toThrow(/more than the/);
    // A student with nothing charged: add the fee first.
    await expect(recordPayment(adminOf(schoolB), { studentId: schoolB.studentIds[0]!, amountMinor: rs(10), paidOn: today(), method: "CASH", notes: null, receiptNo: nextReceipt() })).rejects.toThrow(/Add the fee/);
  });

  it("a void needs a reason, is audited with the amount, and never deletes the receipt", async () => {
    const studentId = schoolA.studentIds[0]!;
    const payment = await recordPayment(adminOf(schoolA), { studentId, amountMinor: rs(50), paidOn: today(), method: "CASH", notes: null, receiptNo: nextReceipt() });
    await expect(voidPayment(adminOf(schoolA), payment.id, " ")).rejects.toBeInstanceOf(AppError);
    await voidPayment(adminOf(schoolA), payment.id, "Entered twice");
    await expect(voidPayment(adminOf(schoolA), payment.id, "Again")).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.feePayment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ voidReason: "Entered twice", voidedById: schoolA.adminUserId });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FEE_PAYMENT_REMOVED", schoolId: schoolA.schoolId }, orderBy: { createdAt: "desc" } });
    expect(audit.metadata).toMatchObject({ paymentId: payment.id, amountMinor: rs(50), reason: "Entered twice" });
  });

  it("a charge money has been applied to cannot be removed", async () => {
    const tuition = (await readStudentFees(adminOf(schoolA), schoolA.studentIds[0]!)).charges.find((row) => row.feeHead.id === tuitionId && row.installmentNo === 1)!;
    await expect(removeCharge(adminOf(schoolA), tuition.id)).rejects.toThrow(/already been applied/);
  });

  it("teachers, parents and students cannot record payments", async () => {
    const payment = { studentId: schoolA.studentIds[0]!, amountMinor: rs(1), paidOn: today(), method: "CASH" as const, notes: null, receiptNo: nextReceipt() };
    await expect(recordPayment(teacherOf(schoolA), payment)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(parentA(), payment)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(studentA(), payment)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("late fees", () => {
  it("adds one late fee per overdue instalment, and applying again adds nothing", async () => {
    await expect(applyLateFees(adminOf(schoolA))).rejects.toThrow(/switched off/);
    await saveLateFeePolicy(adminOf(schoolA), { amountMinor: rs(200), graceDays: 5 });
    const first = await applyLateFees(adminOf(schoolA));
    // Student 0 has nothing overdue now; every other student of the class has two overdue instalments.
    const others = (await prisma.studentEnrollment.count({ where: { sectionId: schoolA.sectionId, status: "ACTIVE" } })) - 1;
    expect(first.added).toBe(others * 2);
    expect((await applyLateFees(adminOf(schoolA))).added).toBe(0);
    const lateFees = await prisma.feeCharge.findMany({ where: { schoolId: schoolA.schoolId, lateFeeForId: { not: null } } });
    expect(lateFees.every((row) => row.amountMinor === rs(200))).toBe(true);
    expect(await prisma.feeCharge.count({ where: { schoolId: schoolA.schoolId, studentId: schoolA.studentIds[0]!, lateFeeForId: { not: null } } })).toBe(0);
    await expect(saveLateFeePolicy(teacherOf(schoolA), { amountMinor: 0, graceDays: 0 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reports and the ledger", () => {
  it("class totals add up from the rows, and the overdue report lists real overdue instalments", async () => {
    const { rows, total } = await classFeeSummary(adminOf(schoolA));
    const accounts = await Promise.all(schoolA.studentIds.map((id) => readStudentFees(adminOf(schoolA), id)));
    expect(total.pendingMinor).toBe(accounts.reduce((sum, account) => sum + account.summary.pendingMinor, 0));
    expect(total.paidMinor).toBe(accounts.reduce((sum, account) => sum + account.summary.paidMinor, 0));
    expect(rows.reduce((sum, row) => sum + row.chargedMinor, 0)).toBe(total.chargedMinor);

    const overdue = await overdueInstallments(adminOf(schoolA));
    expect(overdue.rows.some((row) => row.studentId === schoolA.studentIds[0])).toBe(false);
    expect(overdue.rows.filter((row) => !row.isLateFee).every((row) => row.dueOn < today())).toBe(true);
    const csv = await feeClassSummaryTable(adminOf(schoolA));
    expect(csv.rows.at(-1)?.[0]).toBe("Total");
  });

  it("the ledger's running balance ends at what is pending, with the void shown", async () => {
    const studentId = schoolA.studentIds[0]!;
    const ledger = await studentLedger(adminOf(schoolA), studentId);
    const account = await readStudentFees(adminOf(schoolA), studentId);
    expect(ledger.totals.balanceMinor).toBe(account.summary.pendingMinor);
    expect(ledger.entries.some((row) => row.kind === "VOID" && row.description.includes("Entered twice"))).toBe(true);
    expect((await feeLedgerTable(adminOf(schoolA), studentId)).rows.length).toBe(ledger.entries.length);
  });

  it("a parent sees their own child's instalments and statement, read-only; nobody else does", async () => {
    const fees = await getChildFees(parentA(), schoolA.studentIds[0]!);
    expect(fees.charges.find((row) => row.feeHead.id === tuitionId)).toHaveProperty("status");
    const { ledger } = await getChildLedger(parentA(), schoolA.studentIds[0]!);
    expect(ledger.totals.balanceMinor).toBe(fees.summary.pendingMinor);
    await expect(getChildLedger(parentB(), schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getChildLedger(parentA(), schoolB.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    // The child's profile too: own child only.
    expect((await getChildProfile(parentA(), schoolA.studentIds[0]!)).student.admissionNumber).toBeTruthy();
    await expect(getChildProfile(parentB(), schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("students, teachers and other schools get no fee reports or ledgers", async () => {
    await expect(studentLedger(studentA(), schoolA.studentIds[0]!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(classFeeSummary(studentA())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(classFeeSummary(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(studentLedger(adminOf(schoolB), schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    expect(JSON.stringify(await classFeeSummary(adminOf(schoolB)))).not.toContain(schoolA.studentIds[0]!);
    // A student-side charge correction is not possible either.
    await expect(chargeStudent(studentA(), { studentId: schoolA.studentIds[0]!, feeHeadId: tuitionId, amountMinor: rs(1), dueOn: today(), notes: null })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
