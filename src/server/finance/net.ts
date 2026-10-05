import type { ConcessionKind } from "@/generated/prisma/enums";

/**
 * A charge's net amount: its original amount less its active concession.
 * The charge row is never edited for a discount — the concession says how
 * much comes off — so every screen (the office, the parent, the receipt)
 * works the net out the same way, from the same rows.
 */

/** The active concession on a charge, as every fee read selects it. */
export const ACTIVE_CONCESSION = {
  where: { revokedAt: null },
  orderBy: { createdAt: "desc" as const },
  take: 1,
  select: {
    id: true,
    kind: true,
    value: true,
    reason: true,
    createdAt: true,
    approvedBy: { select: { firstName: true, lastName: true } },
  },
};

/** How much a concession takes off an amount: a fixed sum (never more than the charge) or a percentage. */
export function discountFor(amountMinor: number, concession: { kind: ConcessionKind; value: number } | null | undefined): number {
  if (!concession) return 0;
  const raw = concession.kind === "FIXED" ? concession.value : Math.round((amountMinor * concession.value) / 10_000);
  return Math.max(0, Math.min(raw, amountMinor));
}

/** Original, discount and net for one charge. */
export function netOf(charge: { amountMinor: number; concessions?: Array<{ kind: ConcessionKind; value: number }> }) {
  const discountMinor = discountFor(charge.amountMinor, charge.concessions?.[0]);
  return { originalMinor: charge.amountMinor, discountMinor, netMinor: charge.amountMinor - discountMinor };
}
