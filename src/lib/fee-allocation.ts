/**
 * Which charges a student's payments have covered.
 *
 * A payment is taken against the account ("₹10,000 towards this year"), never
 * split by hand. To say which instalment is still due — and whether it is
 * overdue — the money received is applied to the charges in due-date order:
 * the earliest instalment is settled first, the way a school reads its own
 * books. Nothing is stored; the split is worked out the same way on every
 * screen, from the same rows.
 *
 * All amounts are integer paise, so there is no rounding anywhere here.
 */

export type AllocatableCharge = { id: string; netMinor: number; dueOn: Date; installmentNo?: number };

export type ChargeStatus = "PAID" | "PARTIAL" | "DUE";

export type AllocatedCharge<T extends AllocatableCharge> = T & {
  /** Covered by payments (or carried into a later session). */
  coveredMinor: number;
  /** Still to pay on this charge. */
  remainingMinor: number;
  status: ChargeStatus;
  /** Unpaid (in whole or part) and past its due date. */
  overdue: boolean;
};

/** Earliest due date first; instalments of the same date in order; then by id, so the order is always the same. */
export function byDueOrder(a: AllocatableCharge, b: AllocatableCharge): number {
  return a.dueOn.getTime() - b.dueOn.getTime() || (a.installmentNo ?? 1) - (b.installmentNo ?? 1) || a.id.localeCompare(b.id);
}

/**
 * Apply `creditMinor` (payments plus anything carried forward) to the charges
 * in due order. Returns every charge, in due order, with what is covered and
 * what is left.
 */
export function allocate<T extends AllocatableCharge>(charges: readonly T[], creditMinor: number, asOf: Date): Array<AllocatedCharge<T>> {
  let left = Math.max(0, creditMinor);
  return [...charges].sort(byDueOrder).map((charge) => {
    const net = Math.max(0, charge.netMinor);
    const coveredMinor = Math.min(net, left);
    left -= coveredMinor;
    const remainingMinor = net - coveredMinor;
    const status: ChargeStatus = remainingMinor === 0 ? "PAID" : coveredMinor > 0 ? "PARTIAL" : "DUE";
    return { ...charge, coveredMinor, remainingMinor, status, overdue: remainingMinor > 0 && charge.dueOn < asOf };
  });
}

/** The earliest due date still unpaid, and how much of the balance is overdue. */
export function dueSummary(allocated: ReadonlyArray<{ remainingMinor: number; dueOn: Date; overdue: boolean }>) {
  const open = allocated.filter((row) => row.remainingMinor > 0);
  return {
    nextDueOn: open[0]?.dueOn ?? null,
    overdueMinor: open.filter((row) => row.overdue).reduce((sum, row) => sum + row.remainingMinor, 0),
    overdue: open.some((row) => row.overdue),
  };
}

/**
 * Split a total into `count` instalments in whole paise: equal parts, with
 * the remainder on the last one, so the instalments always add up exactly.
 */
export function splitInstallments(totalMinor: number, count: number): number[] {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) throw new Error("The total must be a positive whole number of paise.");
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("Choose between 1 and 12 instalments.");
  const base = Math.floor(totalMinor / count);
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? totalMinor - base * (count - 1) : base));
}

/** Days from `dueOn` to `asOf` (0 when not yet due). */
export function daysOverdue(dueOn: Date, asOf: Date): number {
  return Math.max(0, Math.floor((asOf.getTime() - dueOn.getTime()) / 86_400_000));
}

/** Ageing bucket for an overdue amount. */
export function ageingBucket(days: number): "0-30" | "31-60" | "61-90" | "90+" {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}
