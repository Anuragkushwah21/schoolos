/**
 * The enquiry fee discussion's arithmetic and the class → stream rule —
 * pure functions shared by the form's preview and the server.
 */
import { describe, expect, it } from "vitest";

import { discountMinorFor, discountProblem, familyTotals, rupeesToMinor, shareFamilyDiscount } from "@/lib/fee-discussion";
import { streamProblem, streamRuleForLevel } from "@/lib/stream-rules";
import { createEnquirySchema, indexedRows } from "@/lib/validation/enquiries";

const rs = (rupees: number) => rupees * 100;

describe("discounts", () => {
  it("works out a fixed, a percentage and no discount", () => {
    expect(discountMinorFor(rs(40_000), "FIXED", rs(5_000))).toBe(rs(5_000));
    expect(discountMinorFor(rs(45_000), "PERCENT", 1_000)).toBe(rs(4_500)); // 10%
    expect(discountMinorFor(rs(45_000), "NONE", 1_000)).toBe(0);
  });

  it("never lets a discount exceed the amount", () => {
    expect(discountProblem(rs(40_000), "FIXED", rs(40_001))).toMatch(/cannot be more than the amount/);
    expect(discountProblem(rs(40_000), "PERCENT", 10_001)).toMatch(/more than 100%/);
    expect(discountProblem(rs(40_000), "FIXED", 0)).toMatch(/Enter the discount/);
    expect(discountProblem(rs(40_000), "FIXED", rs(40_000))).toBeNull();
    expect(discountProblem(rs(40_000), "NONE", 0)).toBeNull();
  });

  it("reads rupees as typed", () => {
    expect(rupeesToMinor("45,000")).toBe(rs(45_000));
    expect(rupeesToMinor("₹ 1,25,500.50")).toBe(12_550_050);
    expect(rupeesToMinor("")).toBeNull();
    expect(rupeesToMinor("abc")).toBeNull();
  });
});

describe("the family's figures", () => {
  // The worked example: Aarav (Class 8), Anaya (Class 10), Riya (Class 12).
  const aarav = { feeOriginalMinor: rs(40_000), discountMinor: rs(5_000), finalMinor: rs(35_000) };
  const anaya = { feeOriginalMinor: rs(45_000), discountMinor: rs(4_500), finalMinor: rs(40_500) };
  const riya = { feeOriginalMinor: rs(55_000), discountMinor: rs(5_000), finalMinor: rs(50_000) };

  it("adds three children: ₹1,40,000 discussed, ₹14,500 off, ₹1,25,500 final", () => {
    const totals = familyTotals([aarav, anaya, riya], { kind: "NONE", value: 0 });
    expect(totals).toMatchObject({ discussedChildren: 3, originalMinor: rs(140_000), totalDiscountMinor: rs(14_500), finalMinor: rs(125_500) });
  });

  it("applies a family / sibling discount on top, and leaves out withdrawn or undiscussed children", () => {
    const totals = familyTotals(
      [
        { feeOriginalMinor: rs(40_000), discountMinor: 0, finalMinor: rs(40_000) },
        { feeOriginalMinor: rs(45_000), discountMinor: 0, finalMinor: rs(45_000) },
        { feeOriginalMinor: rs(50_000), discountMinor: 0, finalMinor: rs(50_000) },
        { status: "WITHDRAWN", feeOriginalMinor: rs(99_000), discountMinor: 0, finalMinor: rs(99_000) },
        { feeOriginalMinor: null, discountMinor: 0, finalMinor: null },
      ],
      { kind: "FIXED", value: rs(10_000) },
    );
    expect(totals).toMatchObject({ discussedChildren: 3, originalMinor: rs(135_000), familyDiscountMinor: rs(10_000), finalMinor: rs(125_000) });
  });

  it("shares a family discount across the children, to the paisa", () => {
    const shares = shareFamilyDiscount([rs(35_000), rs(40_500), rs(50_000)], rs(10_001));
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(rs(10_001));
    expect(shares[2]!).toBeGreaterThan(shares[0]!);
    expect(shareFamilyDiscount([rs(100)], 0)).toEqual([0]);
  });
});

describe("streams by class", () => {
  it("Nursery–8: none; 9–10: optional; 11–12: required", () => {
    expect([-3, -1, 1, 5, 8].map(streamRuleForLevel)).toEqual(["NONE", "NONE", "NONE", "NONE", "NONE"]);
    expect([9, 10].map(streamRuleForLevel)).toEqual(["OPTIONAL", "OPTIONAL"]);
    expect([11, 12].map(streamRuleForLevel)).toEqual(["REQUIRED", "REQUIRED"]);
  });

  it("names the problem", () => {
    expect(streamProblem(8, "science", "Class 8")).toMatch(/has no stream/);
    expect(streamProblem(8, null)).toBeNull();
    expect(streamProblem(9, null)).toBeNull();
    expect(streamProblem(10, "science")).toBeNull();
    expect(streamProblem(11, null, "Class 11")).toMatch(/Choose a stream for Class 11/);
    expect(streamProblem(12, "commerce")).toBeNull();
  });
});

describe("a form with several children", () => {
  it("gathers children.N.field into rows, in order", () => {
    expect(indexedRows({ "children.1.firstName": "B", "children.0.firstName": "A", "children.0.classId": "c1", other: "x" }, "children")).toEqual([
      { firstName: "A", classId: "c1" },
      { firstName: "B" },
    ]);
  });

  it("needs at least one child, and reports a child's error on that child", () => {
    const none = createEnquirySchema.safeParse({ parentName: "Rahul Sharma", phone: "9876543210" });
    expect(none.success).toBe(false);
    const missing = createEnquirySchema.safeParse({ parentName: "Rahul Sharma", phone: "9876543210", "children.0.firstName": "Aarav", "children.0.classId": "c8", "children.1.firstName": "" });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.some((issue) => issue.path.join(".") === "children.1.firstName")).toBe(true);
  });
});
