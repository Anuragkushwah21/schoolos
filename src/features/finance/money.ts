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

/** Shared by the expense form (client) and the expenses filter (server). */
export const EXPENSE_CATEGORY_OPTIONS = [
  { value: "ELECTRICITY", label: "Electricity" },
  { value: "RENT", label: "Rent" },
  { value: "STATIONERY", label: "Stationery" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "EVENTS", label: "Events" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "INTERNET", label: "Internet" },
  { value: "OTHER", label: "Other" },
];

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/**
 * "Rupees Twenty-Six Thousand Five Hundred Only" — the line a printed Indian
 * fee receipt carries under the figure. Uses lakh and crore, as receipts here do.
 */
export function rupeesInWords(minor: number): string {
  const rupeesPart = Math.floor(Math.abs(minor) / 100);
  const paise = Math.abs(minor) % 100;

  const parts: string[] = [];
  let n = rupeesPart;
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));

  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}
