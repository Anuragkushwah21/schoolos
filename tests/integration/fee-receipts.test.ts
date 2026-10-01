/**
 * Printable fee receipts, with two schools side by side.
 *
 * What must hold: the receipt number is the payment's own and never changes on
 * reprint; the arithmetic (total, previously paid, this payment, remaining)
 * matches the fee account; each receipt carries only its own school's name and
 * branding; and only the office, the child's own guardians and — when the
 * school allows it — the student can open one.
 */
import { createHash, randomBytes } from "node:crypto";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as receiptRoute from "@/app/api/v1/fee-payments/[paymentId]/receipt/route";
import { FeeReceipt } from "@/features/finance/receipt";
import { rupeesInWords } from "@/features/finance/money";
import { addDays, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { paymentSchema, receiptSettingsSchema } from "@/lib/validation/school";
import { prisma } from "@/server/db/prisma";
import { chargeStudent, createFeeHead, recordPayment } from "@/server/finance/fees";
import { getReceipt, listStudentReceipts, saveReceiptSettings } from "@/server/finance/receipts";

import { apiRequest, callApi } from "../helpers/api";
import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");
const rs = (rupees: number) => rupees * 100;

/** Payments under test: two for A's first child, one for A's second, one in B. */
const ids = { aFirst: "", aSecond: "", aSibling: "", b: "" };

async function tokenFor(userId: string, schoolId: string) {
  const raw = `sos_${randomBytes(32).toString("base64url")}`;
  await prisma.apiToken.create({
    data: {
      name: "receipt test",
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      prefix: raw.slice(0, 8),
      scope: "READ",
      userId,
      schoolId,
    },
  });
  return raw;
}

async function billAndPay(school: SeededSchool, heads: Array<[string, number]>) {
  const admin = adminOf(school);
  for (const [name, amount] of heads) {
    const head = await createFeeHead(admin, { name, note: null });
    await chargeStudent(admin, {
      studentId: school.studentIds[0]!,
      feeHeadId: head.id,
      amountMinor: rs(amount),
      dueOn: addDays(today(), 30),
      notes: null,
    });
  }
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());

  // Two schools, two different identities.
  await prisma.school.update({
    where: { id: schoolA.schoolId },
    data: {
      name: "Sunrise Test Academy",
      logoUrl: "https://a.example.test/logo.png",
      addressLine: "12 MG Road",
      city: "Indore",
      phone: "0731 111111",
      primaryColor: "#0f766e",
    },
  });
  await prisma.school.update({
    where: { id: schoolB.schoolId },
    data: {
      name: "Green Valley Test School",
      logoUrl: "https://b.example.test/crest.png",
      addressLine: "7 Lake View",
      city: "Bhopal",
      phone: "0755 222222",
    },
  });
  await saveReceiptSettings(adminOf(schoolA), {
    receiptHeaderNote: "Affiliated to CBSE · No. 1030001",
    receiptFooterNote: "Fees once paid are not refundable.",
    showFeesToStudents: false,
  });
  await saveReceiptSettings(adminOf(schoolB), {
    receiptHeaderNote: "Affiliated to MP Board",
    receiptFooterNote: "Keep this slip safe.",
    showFeesToStudents: false,
  });

  // A: ₹26,000 across three heads; ₹10,000 paid earlier, then ₹5,000.
  await billAndPay(schoolA, [
    ["Tuition Fee", 20_000],
    ["Transport Fee", 5_000],
    ["Exam Fee", 1_000],
  ]);
  const base = { studentId: schoolA.studentIds[0]!, notes: null };
  ids.aFirst = (
    await recordPayment(adminOf(schoolA), {
      ...base,
      amountMinor: rs(10_000),
      paidOn: addDays(today(), -5),
      method: "CASH",
      receiptNo: "REC-2026-000122",
    })
  ).id;
  ids.aSecond = (
    await recordPayment(adminOf(schoolA), {
      ...base,
      amountMinor: rs(5_000),
      paidOn: today(),
      method: "UPI",
      receiptNo: "REC-2026-000123",
      referenceNo: "UPI-448812",
    })
  ).id;
  ids.aSibling = (
    await recordPayment(adminOf(schoolA), {
      studentId: schoolA.studentIds[1]!,
      notes: null,
      amountMinor: rs(1_500),
      paidOn: today(),
      method: "CASH",
      receiptNo: "REC-2026-000124",
    })
  ).id;

  await billAndPay(schoolB, [["Tuition Fee", 12_000]]);
  ids.b = (
    await recordPayment(adminOf(schoolB), {
      studentId: schoolB.studentIds[0]!,
      notes: null,
      amountMinor: rs(4_000),
      paidOn: today(),
      method: "CHEQUE",
      // The same number as in school A: receipt numbers are per school.
      receiptNo: "REC-2026-000123",
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("receipt contents", () => {
  it("adds up the fee account at the moment of this payment", async () => {
    const receipt = await getReceipt(adminOf(schoolA), ids.aSecond);

    expect(receipt.fees.breakdown).toEqual([
      { head: "Exam Fee", amountMinor: rs(1_000) },
      { head: "Transport Fee", amountMinor: rs(5_000) },
      { head: "Tuition Fee", amountMinor: rs(20_000) },
    ]);
    expect(receipt.fees).toMatchObject({
      totalMinor: rs(26_000),
      previouslyPaidMinor: rs(10_000),
      currentMinor: rs(5_000),
      remainingMinor: rs(11_000),
      excessMinor: 0,
    });

    // The earlier receipt, reprinted, still shows the account as it was then.
    const first = await getReceipt(adminOf(schoolA), ids.aFirst);
    expect(first.fees).toMatchObject({ previouslyPaidMinor: 0, currentMinor: rs(10_000), remainingMinor: rs(16_000) });
  });

  it("carries the student, class, guardian and payment details", async () => {
    const receipt = await getReceipt(adminOf(schoolA), ids.aSecond);
    expect(receipt.student).toMatchObject({ admissionNumber: "ADM1", className: "Class 10", sectionName: "A", rollNumber: "1" });
    expect(receipt.guardian?.phone).toBeTruthy();
    expect(receipt.payment).toMatchObject({ method: "UPI", referenceNo: "UPI-448812" });
    expect(receipt.session.name).toBe("2026-27");
  });

  it("keeps the same receipt number however often it is printed", async () => {
    const before = await prisma.feePayment.count({ where: { schoolId: schoolA.schoolId } });
    const numbers = await Promise.all([1, 2, 3].map(() => getReceipt(adminOf(schoolA), ids.aSecond)));
    expect(new Set(numbers.map((r) => r.payment.receiptNo))).toEqual(new Set(["REC-2026-000123"]));
    expect(await prisma.feePayment.count({ where: { schoolId: schoolA.schoolId } })).toBe(before);
  });

  it("writes the amount in words", () => {
    expect(rupeesInWords(rs(5_000))).toBe("Rupees Five Thousand Only");
    expect(rupeesInWords(rs(126_500))).toBe("Rupees One Lakh Twenty Six Thousand Five Hundred Only");
  });
});

describe("school-specific branding", () => {
  it("prints each school's own identity and never the other's", async () => {
    const a = await getReceipt(adminOf(schoolA), ids.aSecond);
    const b = await getReceipt(adminOf(schoolB), ids.b);

    expect(a.school).toMatchObject({
      name: "Sunrise Test Academy",
      logoUrl: "https://a.example.test/logo.png",
      headerNote: "Affiliated to CBSE · No. 1030001",
      footerNote: "Fees once paid are not refundable.",
    });
    expect(b.school).toMatchObject({
      name: "Green Valley Test School",
      logoUrl: "https://b.example.test/crest.png",
      headerNote: "Affiliated to MP Board",
    });

    // The rendered, printable receipt, in both sizes.
    for (const format of ["a4", "slip"] as const) {
      const htmlA = renderToStaticMarkup(createElement(FeeReceipt, { receipt: a, format }));
      const htmlB = renderToStaticMarkup(createElement(FeeReceipt, { receipt: b, format }));

      expect(htmlA).toContain("Sunrise Test Academy");
      expect(htmlA).toContain("https://a.example.test/logo.png");
      expect(htmlA).toContain("12 MG Road, Indore");
      expect(htmlA).toContain("REC-2026-000123");
      expect(htmlA).toContain("Rupees Five Thousand Only");
      expect(htmlA).not.toContain("Green Valley");
      expect(htmlA).not.toContain("b.example.test");

      expect(htmlB).toContain("Green Valley Test School");
      expect(htmlB).toContain("Keep this slip safe.");
      expect(htmlB).not.toContain("Sunrise");
      expect(htmlB).not.toContain("a.example.test");
    }
  });

  it("does not let one school's admin open another school's receipt, even with the same number", async () => {
    await expect(getReceipt(adminOf(schoolB), ids.aSecond)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getReceipt(adminOf(schoolA), ids.b)).rejects.toBeInstanceOf(NotFoundError);

    const token = await tokenFor(schoolB.adminUserId, schoolB.schoolId);
    const result = await callApi(
      receiptRoute.GET,
      apiRequest(`/api/v1/fee-payments/${ids.aSecond}/receipt`, { token }),
      { paymentId: ids.aSecond },
    );
    expect(result.status).toBe(404);
  });
});

describe("who may open a receipt", () => {
  it("lets a parent open their own children's receipts, over the API too", async () => {
    expect((await getReceipt(parentOf(schoolA), ids.aSecond)).payment.receiptNo).toBe("REC-2026-000123");
    expect((await listStudentReceipts(parentOf(schoolA), schoolA.studentIds[0]!)).map((r) => r.id)).toEqual([
      ids.aSecond,
      ids.aFirst,
    ]);

    const token = await tokenFor(schoolA.parentUserId, schoolA.schoolId);
    const result = await callApi(
      receiptRoute.GET,
      apiRequest(`/api/v1/fee-payments/${ids.aSecond}/receipt`, { token }),
      { paymentId: ids.aSecond },
    );
    expect(result.status).toBe(200);
    expect((result.body.data as { school: { name: string } }).school.name).toBe("Sunrise Test Academy");
  });

  it("refuses a parent a child they are not linked to, and another school's parent", async () => {
    await prisma.parentStudent.deleteMany({ where: { studentId: schoolA.studentIds[1]! } });
    await expect(getReceipt(parentOf(schoolA), ids.aSibling)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getReceipt(parentOf(schoolB), ids.aSecond)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never shows a student a receipt — fees are for parents only, whatever the old setting says", async () => {
    await expect(getReceipt(studentOf(schoolA), ids.aSecond)).rejects.toBeInstanceOf(ForbiddenError);

    await saveReceiptSettings(
      adminOf(schoolA),
      receiptSettingsSchema.parse({ receiptHeaderNote: "Affiliated to CBSE · No. 1030001", showFeesToStudents: "on" }),
    );
    await expect(getReceipt(studentOf(schoolA), ids.aSecond)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getReceipt(studentOf(schoolB), ids.b)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps teachers out", async () => {
    await expect(getReceipt(teacherOf(schoolA), ids.aSecond)).rejects.toBeInstanceOf(ForbiddenError);
    const token = await tokenFor(schoolA.teacherUserId, schoolA.schoolId);
    const result = await callApi(
      receiptRoute.GET,
      apiRequest(`/api/v1/fee-payments/${ids.aSecond}/receipt`, { token }),
      { paymentId: ids.aSecond },
    );
    expect(result.status).toBe(403);
  });
});

describe("recording a payment", () => {
  it("accepts an optional reference number and still refuses a reused receipt number", async () => {
    const parsed = paymentSchema.parse({
      studentId: schoolA.studentIds[0],
      amountMinor: "100",
      paidOn: "2026-09-01",
      method: "CHEQUE",
      receiptNo: "REC-X",
      referenceNo: "",
    });
    expect(parsed.referenceNo).toBeNull();

    await expect(
      recordPayment(adminOf(schoolA), {
        studentId: schoolA.studentIds[0]!,
        amountMinor: rs(100),
        paidOn: today(),
        method: "CASH",
        receiptNo: "REC-2026-000123",
        notes: null,
      }),
    ).rejects.toThrow(/already been used/);
  });
});
