import "server-only";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { discountFor } from "@/server/finance/net";

/**
 * Discounts and concessions — School Admin only.
 *
 * A concession never edits the charge: the charge keeps its original amount
 * and the concession records how much comes off (a fixed sum or a
 * percentage), why, and who approved it. Changing one revokes the old row and
 * adds a new one, so the history of what was agreed is never lost.
 */

const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export async function grantConcession(
  ctx: TenantContext,
  input: { chargeId: string; kind: "FIXED" | "PERCENT"; amountRupees?: number | null; percent?: number | null; reason: string },
): Promise<{ discountMinor: number; netMinor: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const charge = await ctx.db.feeCharge.findFirst({
    where: { id: input.chargeId },
    select: {
      id: true,
      amountMinor: true,
      feeHead: { select: { name: true, isSystem: true } },
      student: { select: { firstName: true, lastName: true } },
      concessions: { where: { revokedAt: null }, select: { id: true } },
    },
  });
  if (!charge) throw new NotFoundError("That charge was not found.");
  if (charge.feeHead.isSystem) throw new ConflictError("A carried-forward balance is not discounted here. Give the concession on the original session's fees.");

  let value: number;
  if (input.kind === "FIXED") {
    const minor = Math.round((input.amountRupees ?? 0) * 100);
    if (!(minor > 0)) throw new ValidationError("Please correct the highlighted fields.", { amountRupees: ["Enter the discount in rupees"] });
    if (minor > charge.amountMinor) throw new ValidationError("Please correct the highlighted fields.", { amountRupees: [`The discount cannot be more than the fee (${rupees(charge.amountMinor)})`] });
    value = minor;
  } else {
    const percent = input.percent ?? 0;
    if (!(percent > 0 && percent <= 100)) throw new ValidationError("Please correct the highlighted fields.", { percent: ["Enter a percentage from 1 to 100"] });
    value = Math.round(percent * 100);
  }
  const discountMinor = discountFor(charge.amountMinor, { kind: input.kind, value });

  await ctx.db.$transaction(async (tx) => {
    // One active concession per charge: a change replaces it, keeping the old row.
    if (charge.concessions.length) {
      await tx.feeConcession.updateMany({
        where: { feeChargeId: charge.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: ctx.user.id, revokeReason: "Replaced by a new concession" },
      });
    }
    await tx.feeConcession.create({
      data: {
        schoolId: ctx.schoolId,
        feeChargeId: charge.id,
        kind: input.kind,
        value,
        discountMinor,
        originalMinor: charge.amountMinor,
        reason: input.reason,
        approvedById: ctx.user.id,
      },
    });
  });
  await recordAudit({
    action: "FEE_CONCESSION_APPROVED",
    entityType: "FeeCharge",
    entityId: charge.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Concession for ${fullName(charge.student)} on ${charge.feeHead.name}: ${rupees(charge.amountMinor)} − ${rupees(discountMinor)}${input.kind === "PERCENT" ? ` (${value / 100}%)` : ""} = ${rupees(charge.amountMinor - discountMinor)}. Reason: ${input.reason}`,
  });
  return { discountMinor, netMinor: charge.amountMinor - discountMinor };
}

export async function revokeConcession(ctx: TenantContext, concessionId: string, reason: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const concession = await ctx.db.feeConcession.findFirst({
    where: { id: concessionId, revokedAt: null },
    select: { id: true, feeChargeId: true, charge: { select: { feeHead: { select: { name: true } }, student: { select: { firstName: true, lastName: true } } } } },
  });
  if (!concession) throw new NotFoundError("That concession was not found, or has already been withdrawn.");
  await ctx.db.feeConcession.updateMany({ where: { id: concession.id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: ctx.user.id, revokeReason: reason } });
  await recordAudit({
    action: "FEE_CONCESSION_REVOKED",
    entityType: "FeeCharge",
    entityId: concession.feeChargeId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Concession on ${concession.charge.feeHead.name} for ${fullName(concession.charge.student)} withdrawn: ${reason}`,
  });
}

/** Every concession a charge has had, newest first — what was agreed, by whom, and what replaced it. */
export async function concessionHistory(ctx: TenantContext, chargeId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.feeConcession.findMany({
    where: { feeChargeId: chargeId },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, value: true, discountMinor: true, originalMinor: true, reason: true, createdAt: true, revokedAt: true, revokeReason: true, approvedBy: { select: { firstName: true, lastName: true } } },
  });
}
