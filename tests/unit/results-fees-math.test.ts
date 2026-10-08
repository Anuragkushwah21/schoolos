/**
 * The arithmetic behind results and fees, on its own: deterministic, integer
 * where money and marks are involved, and the rules stated in the code.
 */
import { describe, expect, it } from "vitest";

import { addMonths, installmentDates } from "@/lib/dates";
import { ageingBucket, allocate, daysOverdue, dueSummary, splitInstallments } from "@/lib/fee-allocation";
import { DEFAULT_BANDS, checkBands, examOutcome, gradeFor, gradingKey, isEntered, paperOutcome, passMarkFor, percentage, rulesFrom, weightedPercent } from "@/lib/grades";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("percentages and grades", () => {
  it("rounds half up to one decimal in integer arithmetic", () => {
    expect(percentage(2, 3)).toBe(66.7);
    expect(percentage(1, 3)).toBe(33.3);
    expect(percentage(909, 2000)).toBe(45.5); // 45.45 → 45.5, never 45.4
    expect(percentage(91, 100)).toBe(91);
    expect(percentage(0, 50)).toBe(0);
    expect(percentage(5, 0)).toBeNull();
  });

  it("grades by the default CBSE scale, or by a school's own", () => {
    expect(gradeFor(91)).toBe("A1");
    expect(gradeFor(90.9)).toBe("A2");
    expect(gradeFor(32.9)).toBe("E");
    const bands = [
      { min: 90, grade: "O" },
      { min: 75, grade: "A" },
      { min: 50, grade: "B" },
      { min: 0, grade: "F" },
    ];
    expect(gradeFor(89.9, bands)).toBe("A");
    expect(gradeFor(50, bands)).toBe("B");
    expect(gradeFor(10, bands)).toBe("F");
    expect(gradingKey(bands)).toBe("O 90–100 · A 75–89 · B 50–74 · F 0–49");
  });

  it("refuses invalid grading scales", () => {
    expect(checkBands([{ min: 50, grade: "P" }, { min: 10, grade: "F" }])).toMatchObject({ ok: false, reason: expect.stringMatching(/start at 0%/) });
    expect(checkBands([{ min: 50, grade: "P" }, { min: 50, grade: "Q" }, { min: 0, grade: "F" }])).toMatchObject({ ok: false, reason: expect.stringMatching(/same percentage/) });
    expect(checkBands([{ min: 120, grade: "P" }, { min: 0, grade: "F" }])).toMatchObject({ ok: false });
    expect(checkBands([{ min: 50, grade: "P" }, { min: 0, grade: "p" }])).toMatchObject({ ok: false, reason: expect.stringMatching(/once/) });
    expect(checkBands([{ min: 0, grade: "F" }, { min: 40, grade: "P" }])).toEqual({ ok: true, bands: [{ min: 40, grade: "P" }, { min: 0, grade: "F" }] });
    // Stored garbage falls back to the default rather than breaking a report card.
    expect(rulesFrom({ gradeBands: "nonsense", passPercent: 500 })).toEqual({ bands: DEFAULT_BANDS, passPercent: 33 });
  });

  it("pass marks follow the paper, else the school's pass percentage (rounded up)", () => {
    expect(passMarkFor(100, null)).toBe(33);
    expect(passMarkFor(80, null)).toBe(27); // 26.4 → 27
    expect(passMarkFor(80, null, 40)).toBe(32);
    expect(passMarkFor(80, 20, 40)).toBe(20);
  });

  it("an exempt paper is left out; an absent one fails; a missing mark is incomplete", () => {
    const paper = { maxMarks: 100, passMarks: null };
    expect(paperOutcome(paper, { marksObtained: null, absent: false, exempt: true })).toBe("EXEMPT");
    expect(paperOutcome(paper, { marksObtained: null, absent: true })).toBe("ABSENT");
    expect(paperOutcome(paper, { marksObtained: 39, absent: false }, 40)).toBe("FAIL");
    expect(examOutcome(["PASS", "EXEMPT", "PASS"])).toBe("PASS");
    expect(examOutcome(["PASS", "ABSENT"])).toBe("FAIL");
    expect(examOutcome(["PASS", "PENDING"])).toBe("INCOMPLETE");
    expect(examOutcome(["EXEMPT"])).toBe("INCOMPLETE");
    expect(isEntered({ marksObtained: null, absent: false, exempt: true })).toBe(true);
    expect(isEntered({ marksObtained: null, absent: false })).toBe(false);
  });

  it("weights exam percentages, never raw marks, and leaves out what does not count", () => {
    // 80% weighted 40 and 60% weighted 60 → 68%.
    expect(weightedPercent([{ percent: 80, weight: 40 }, { percent: 60, weight: 60 }])).toBe(68);
    // A component without a result is left out: the other carries the weight.
    expect(weightedPercent([{ percent: 75, weight: 30 }, { percent: null, weight: 70 }])).toBe(75);
    expect(weightedPercent([{ percent: 66.7, weight: 50 }, { percent: 33.3, weight: 50 }])).toBe(50);
    expect(weightedPercent([{ percent: null, weight: 100 }])).toBeNull();
  });
});

describe("fee allocation", () => {
  const charges = [
    { id: "t2", netMinor: 5_000_00, dueOn: d("2026-07-10"), installmentNo: 2 },
    { id: "t1", netMinor: 5_000_00, dueOn: d("2026-04-10"), installmentNo: 1 },
    { id: "t3", netMinor: 5_000_00, dueOn: d("2026-10-10"), installmentNo: 3 },
  ];

  it("settles the earliest instalment first", () => {
    const rows = allocate(charges, 7_000_00, d("2026-08-01"));
    expect(rows.map((row) => [row.id, row.status, row.remainingMinor, row.overdue])).toEqual([
      ["t1", "PAID", 0, false],
      ["t2", "PARTIAL", 3_000_00, true],
      ["t3", "DUE", 5_000_00, false],
    ]);
    expect(dueSummary(rows)).toEqual({ nextDueOn: d("2026-07-10"), overdueMinor: 3_000_00, overdue: true });
  });

  it("a paid first instalment no longer makes the account overdue", () => {
    const rows = allocate(charges, 5_000_00, d("2026-05-01"));
    expect(dueSummary(rows)).toEqual({ nextDueOn: d("2026-07-10"), overdueMinor: 0, overdue: false });
  });

  it("splits instalments in whole paise that add up exactly", () => {
    expect(splitInstallments(10_000_00, 3)).toEqual([3_333_33, 3_333_33, 3_333_34]);
    expect(splitInstallments(10_000_00, 3).reduce((a, b) => a + b, 0)).toBe(10_000_00);
    expect(() => splitInstallments(100, 13)).toThrow();
    expect(() => splitInstallments(0, 2)).toThrow();
  });

  it("instalment dates step by months, clamped to short months", () => {
    expect(addMonths(d("2026-01-31"), 1)).toEqual(d("2026-02-28"));
    expect(installmentDates(d("2026-04-10"), 3, 3)).toEqual([d("2026-04-10"), d("2026-07-10"), d("2026-10-10")]);
  });

  it("ages overdue amounts", () => {
    expect(daysOverdue(d("2026-07-01"), d("2026-08-15"))).toBe(45);
    expect(daysOverdue(d("2026-09-01"), d("2026-08-15"))).toBe(0);
    expect(ageingBucket(30)).toBe("0-30");
    expect(ageingBucket(45)).toBe("31-60");
    expect(ageingBucket(91)).toBe("90+");
  });
});
