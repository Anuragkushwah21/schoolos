/**
 * Fees for families: concessions that never rewrite the original charge,
 * last session's balance carried forward explicitly (never merged
 * silently), each child's fees shown separately with a family total, and one
 * family payment split per child — every account kept apart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { carryForward, carryForwardCandidates, previousDues } from "@/server/finance/carry-forward";
import { concessionHistory, grantConcession, revokeConcession } from "@/server/finance/concessions";
import { familyFees, getFamilyReceipt, recordFamilyPayment, setFamilyPaymentEnabled, voidFamilyPayment } from "@/server/finance/family";
import { listFeePositions, readStudentFees, removeCharge } from "@/server/finance/fees";
import { getReceipt } from "@/server/finance/receipts";
import { prisma } from "@/server/db/prisma";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let tuitionId: string;
let transportId: string;
let earlierSessionId: string;
const rs = (rupees: number) => rupees * 100;
const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const schoolId = schoolA.schoolId;
  tuitionId = (await prisma.feeHead.create({ data: { schoolId, name: "Tuition (fam)" } })).id;
  transportId = (await prisma.feeHead.create({ data: { schoolId, name: "Transport (fam)" } })).id;
  const [rahul, priya] = schoolA.studentIds;
  const charge = (studentId: string, feeHeadId: string, rupees: number, sessionId = schoolA.academicSessionId) =>
    prisma.feeCharge.create({ data: { schoolId, academicSessionId: sessionId, studentId, feeHeadId, amountMinor: rs(rupees), dueOn: addDays(today(), 10) } });
  // This session: Rahul tuition 20,000 + transport 5,000; Priya tuition 30,000.
  await charge(rahul!, tuitionId, 20_000);
  await charge(rahul!, transportId, 5_000);
  await charge(priya!, tuitionId, 30_000);
  await prisma.feePayment.create({ data: { schoolId, academicSessionId: schoolA.academicSessionId, studentId: rahul!, amountMinor: rs(15_000), paidOn: today(), receiptNo: "REC-FAM-1" } });
  await prisma.feePayment.create({ data: { schoolId, academicSessionId: schoolA.academicSessionId, studentId: priya!, amountMinor: rs(15_000), paidOn: today(), receiptNo: "REC-FAM-2" } });
  // Last session: Rahul still owes 8,000 of a 10,000 tuition.
  earlierSessionId = (
    await prisma.academicSession.create({ data: { schoolId, name: "2025-26 (fam)", startDate: new Date(Date.UTC(2025, 3, 1)), endDate: new Date(Date.UTC(2026, 2, 31)) } })
  ).id;
  await charge(rahul!, tuitionId, 10_000, earlierSessionId);
  await prisma.feePayment.create({ data: { schoolId, academicSessionId: earlierSessionId, studentId: rahul!, amountMinor: rs(2_000), paidOn: new Date(Date.UTC(2025, 6, 1)), receiptNo: "REC-FAM-0" } });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("concessions", () => {
  it("takes a fixed or percentage discount off the net, keeps the original, and keeps every change", async () => {
    const priya = schoolA.studentIds[1]!;
    const tuition = await prisma.feeCharge.findFirstOrThrow({ where: { studentId: priya, feeHeadId: tuitionId, academicSessionId: schoolA.academicSessionId } });

    expect(await grantConcession(adminOf(schoolA), { chargeId: tuition.id, kind: "FIXED", amountRupees: 5_000, reason: "Sibling discount" })).toEqual({ discountMinor: rs(5_000), netMinor: rs(25_000) });
    let fees = await readStudentFees(adminOf(schoolA), priya);
    expect(fees.charges[0]).toMatchObject({ originalMinor: rs(30_000), discountMinor: rs(5_000), netMinor: rs(25_000) });
    expect(fees.summary).toMatchObject({ chargedMinor: rs(25_000), pendingMinor: rs(10_000) });
    // The charge row itself is untouched.
    expect((await prisma.feeCharge.findUniqueOrThrow({ where: { id: tuition.id } })).amountMinor).toBe(rs(30_000));

    // A percentage replaces it; the old one stays in the history.
    await grantConcession(adminOf(schoolA), { chargeId: tuition.id, kind: "PERCENT", percent: 10, reason: "Staff child" });
    fees = await readStudentFees(adminOf(schoolA), priya);
    expect(fees.charges[0]).toMatchObject({ discountMinor: rs(3_000), netMinor: rs(27_000) });
    const history = await concessionHistory(adminOf(schoolA), tuition.id);
    expect(history).toHaveLength(2);
    expect(history[1]!.revokedAt).not.toBeNull();

    // The admin list and the receipt use the same net figure.
    const position = (await listFeePositions(adminOf(schoolA))).rows.find((row) => row.studentId === priya)!;
    expect(position.summary.chargedMinor).toBe(rs(27_000));
    const paymentId = (await prisma.feePayment.findFirstOrThrow({ where: { receiptNo: "REC-FAM-2" } })).id;
    expect((await getReceipt(adminOf(schoolA), paymentId)).fees.totalMinor).toBe(rs(27_000));

    // Rules: no more than the fee, admin only, nothing across schools.
    await expect(grantConcession(adminOf(schoolA), { chargeId: tuition.id, kind: "FIXED", amountRupees: 40_000, reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(grantConcession(adminOf(schoolA), { chargeId: tuition.id, kind: "PERCENT", percent: 120, reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(grantConcession(teacherOf(schoolA), { chargeId: tuition.id, kind: "PERCENT", percent: 5, reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(grantConcession(adminOf(schoolB), { chargeId: tuition.id, kind: "PERCENT", percent: 5, reason: "x" })).rejects.toBeInstanceOf(NotFoundError);

    // Withdrawn: back to the full fee.
    await revokeConcession(adminOf(schoolA), history[0]!.id, "Mistake");
    expect((await readStudentFees(adminOf(schoolA), priya)).summary.chargedMinor).toBe(rs(30_000));
  });
});

describe("previous year's balance", () => {
  it("shows it separately, carries it forward on request with its source, and never twice", async () => {
    const rahul = schoolA.studentIds[0]!;
    expect(await previousDues(adminOf(schoolA), rahul)).toEqual([{ sessionId: earlierSessionId, sessionName: "2025-26 (fam)", pendingMinor: rs(8_000) }]);
    expect((await carryForwardCandidates(adminOf(schoolA))).some((row) => row.studentId === rahul)).toBe(true);
    await expect(carryForward(teacherOf(schoolA), rahul, earlierSessionId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(carryForward(adminOf(schoolA), rahul, schoolA.academicSessionId)).rejects.toThrow(/earlier session/);

    expect(await carryForward(adminOf(schoolA), rahul, earlierSessionId)).toEqual({ amountMinor: rs(8_000) });
    // Old session: carried, not owed. New session: one explicit line, with its source.
    const old = await readStudentFees(adminOf(schoolA), rahul, earlierSessionId);
    expect(old.summary).toMatchObject({ pendingMinor: 0, carriedForwardMinor: rs(8_000), paidMinor: rs(2_000) });
    expect(old.carriedOut?.amountMinor).toBe(rs(8_000));
    const now = await readStudentFees(adminOf(schoolA), rahul);
    const carried = now.charges.find((row) => row.carriedFrom);
    expect(carried).toMatchObject({ netMinor: rs(8_000), carriedFrom: { name: "2025-26 (fam)" } });
    expect(carried!.feeHead.name).toBe("Previous outstanding (2025-26 (fam))");
    // 25,000 this year + 8,000 brought forward − 15,000 paid.
    expect(now.summary.pendingMinor).toBe(rs(18_000));

    await expect(carryForward(adminOf(schoolA), rahul, earlierSessionId)).rejects.toBeInstanceOf(ConflictError);
    await expect(removeCharge(adminOf(schoolA), carried!.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await previousDues(adminOf(schoolA), rahul)).toEqual([]);
  });
});

describe("family fees and one family payment", () => {
  it("shows each child separately with a family total, to that family only", async () => {
    const family = await familyFees(parentOf(schoolA));
    const [rahul, priya] = schoolA.studentIds;
    const rahulRow = family.children.find((child) => child.id === rahul)!;
    const priyaRow = family.children.find((child) => child.id === priya)!;
    expect(rahulRow.charges.map((row) => row.head).sort()).toEqual(["Previous outstanding (2025-26 (fam))", "Transport (fam)", "Tuition (fam)"]);
    expect(rahulRow.summary.pendingMinor).toBe(rs(18_000));
    expect(priyaRow.summary.pendingMinor).toBe(rs(15_000));
    expect(family.totals.payableMinor).toBe(family.children.reduce((sum, child) => sum + child.payableMinor, 0));
    // Another school's parent cannot open this family; a parent cannot name another parent.
    await expect(familyFees(parentOf(schoolB), schoolA.parentId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(familyFees(adminOf(schoolB), schoolA.parentId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("splits one payment per child, refuses overpaying a child, and voids as one", async () => {
    const [rahul, priya] = schoolA.studentIds;
    const payment = { parentId: schoolA.parentId, paidOn: today(), method: "UPI" as const, referenceNo: "UPI-7781", notes: null, allocations: [{ studentId: rahul!, amountMinor: rs(10_000) }, { studentId: priya!, amountMinor: rs(15_000) }] };

    await expect(recordFamilyPayment(adminOf(schoolA), payment)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setFamilyPaymentEnabled(teacherOf(schoolA), true)).rejects.toBeInstanceOf(ForbiddenError);
    await setFamilyPaymentEnabled(adminOf(schoolA), true);

    await expect(
      recordFamilyPayment(adminOf(schoolA), { ...payment, allocations: [{ studentId: priya!, amountMinor: rs(16_000) }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(recordFamilyPayment(adminOf(schoolA), { ...payment, allocations: [{ studentId: schoolB.studentIds[0]!, amountMinor: rs(100) }] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordFamilyPayment(parentOf(schoolA), payment)).rejects.toBeInstanceOf(ForbiddenError);

    const recorded = await recordFamilyPayment(adminOf(schoolA), payment);
    expect(recorded.totalMinor).toBe(rs(25_000));
    const parts = await prisma.feePayment.findMany({ where: { familyPaymentId: recorded.id }, orderBy: { receiptNo: "asc" } });
    expect(parts.map((part) => [part.studentId, part.amountMinor, part.receiptNo])).toEqual([
      [rahul, rs(10_000), `${recorded.receiptNo}/1`],
      [priya, rs(15_000), `${recorded.receiptNo}/2`],
    ]);
    // Each account moves on its own; none is merged.
    expect((await readStudentFees(adminOf(schoolA), rahul!)).summary.pendingMinor).toBe(rs(8_000));
    expect((await readStudentFees(adminOf(schoolA), priya!)).summary.pendingMinor).toBe(0);

    // The family receipt says which amount was for which child — and only this family reads it.
    const receipt = await getFamilyReceipt(parentOf(schoolA), recorded.id);
    expect(receipt.parts.map((part) => [part.studentId, part.amountMinor])).toEqual([
      [rahul, rs(10_000)],
      [priya, rs(15_000)],
    ]);
    await expect(getFamilyReceipt(parentOf(schoolB), recorded.id)).rejects.toBeInstanceOf(NotFoundError);

    await voidFamilyPayment(adminOf(schoolA), recorded.id, "Cheque bounced");
    expect(await prisma.feePayment.count({ where: { familyPaymentId: recorded.id, voidedAt: null } })).toBe(0);
    expect((await readStudentFees(adminOf(schoolA), priya!)).summary.pendingMinor).toBe(rs(15_000));
  });
});
