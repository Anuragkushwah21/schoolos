/**
 * The arithmetic of an enquiry's fee discussion — a negotiation record, not a
 * fee. Amounts are paise; a percentage is stored in basis points (10% = 1000).
 * Shared by the form's live preview and the server, so both show the same
 * figures.
 */

export type DiscountKind = "NONE" | "FIXED" | "PERCENT";

export const DISCOUNT_REASONS = [
  "Sibling admission",
  "Local fee discussion",
  "Returning family",
  "Special concession",
  "Management-approved discount",
  "Other",
] as const;

/** How much comes off. FIXED: `value` paise. PERCENT: `value` basis points. */
export function discountMinorFor(originalMinor: number, kind: DiscountKind, value: number): number {
  if (kind === "NONE" || originalMinor <= 0) return 0;
  return kind === "FIXED" ? value : Math.round((originalMinor * value) / 10_000);
}

/** The problem with a discount, or null. A discount can never exceed the amount. */
export function discountProblem(originalMinor: number, kind: DiscountKind, value: number): string | null {
  if (kind === "NONE") return null;
  if (!(value > 0)) return kind === "FIXED" ? "Enter the discount amount" : "Enter the discount percentage";
  if (kind === "PERCENT" && value > 10_000) return "A percentage discount cannot be more than 100%";
  if (kind === "FIXED" && value > originalMinor) return "The discount cannot be more than the amount";
  return null;
}

export type DiscussedChild = { status?: string; feeOriginalMinor: number | null; discountMinor: number; finalMinor: number | null };

/**
 * The family's figures: the original total, each child's discounts, the
 * family discount (on what is left after the children's own), and the final
 * family amount. Withdrawn children and children not yet discussed are left out.
 */
export function familyTotals(children: DiscussedChild[], family: { kind: DiscountKind; value: number }) {
  const counted = children.filter((child) => child.status !== "WITHDRAWN" && child.feeOriginalMinor !== null);
  const originalMinor = counted.reduce((sum, child) => sum + (child.feeOriginalMinor ?? 0), 0);
  const childDiscountMinor = counted.reduce((sum, child) => sum + child.discountMinor, 0);
  const subtotalMinor = originalMinor - childDiscountMinor;
  const familyDiscountMinor = Math.min(discountMinorFor(subtotalMinor, family.kind, family.value), subtotalMinor);
  const totalDiscountMinor = childDiscountMinor + familyDiscountMinor;
  return {
    discussedChildren: counted.length,
    originalMinor,
    childDiscountMinor,
    subtotalMinor,
    familyDiscountMinor,
    totalDiscountMinor,
    finalMinor: originalMinor - totalDiscountMinor,
  };
}

/**
 * Split a family discount across the children in proportion to their
 * discussed amounts (the last child takes the rounding), so each child's
 * agreed discount can later become a concession on that child's own fees.
 */
export function shareFamilyDiscount(finals: number[], familyDiscountMinor: number): number[] {
  const total = finals.reduce((sum, value) => sum + value, 0);
  if (!familyDiscountMinor || total <= 0) return finals.map(() => 0);
  let given = 0;
  return finals.map((value, index) => {
    if (index === finals.length - 1) return familyDiscountMinor - given;
    const share = Math.floor((familyDiscountMinor * value) / total);
    given += share;
    return share;
  });
}

/** Rupees typed in a form ("45000", "45,000.50") to paise; null when blank or not a number. */
export function rupeesToMinor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[,\s₹]/g, "");
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}
