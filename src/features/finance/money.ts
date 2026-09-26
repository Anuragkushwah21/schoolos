/**
 * Money on screen.
 *
 * Amounts are integer paise everywhere in the database and everywhere in these
 * modules; they become rupees only here, at the edge. Keeping the conversion in
 * one place is what stops two screens disagreeing about ₹25,000 by a rounding
 * error.
 */
export function rupees(minor: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    // Schools bill in whole rupees; showing ".00" on every figure is noise.
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/** For a number input, which wants a plain value rather than a currency string. */
export function toRupeeInput(minor: number): string {
  return String(minor / 100);
}

export const FEE_STATUS_LABEL = {
  PAID: "Paid",
  PARTIAL: "Partially paid",
  PENDING: "Pending",
  NONE: "Nothing charged",
} as const;

/** Status tones, so a paid account reads green wherever it appears. */
export const FEE_STATUS_TONE = {
  PAID: "positive",
  PARTIAL: "warning",
  PENDING: "negative",
  NONE: "neutral",
} as const;
