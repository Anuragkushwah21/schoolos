import "server-only";

import { addDays, today } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { requireCurrentSession } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import { isUniqueViolation } from "@/server/db/errors";
import { loadSessionAccounts } from "@/server/finance/fee-reports";
import { assertModuleEnabled } from "@/server/platform/modules";

/**
 * Late fees, by the school's own policy (Settings on the fees page): a fixed
 * amount added once to each instalment still unpaid a number of days after it
 * fell due. Nothing happens on its own — the office presses "Apply late fees",
 * sees how many were added, and every one is a normal charge the family sees,
 * on a "Late fee" head, linked to the instalment it is for. Applying twice adds
 * nothing new (one late fee per instalment, enforced by the database).
 */

const LATE_FEE_HEAD = "Late fee";

export async function lateFeePolicy(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect", "fees.manage"]);
  const school = await ctx.db.school.findFirst({ select: { lateFeeMinor: true, lateFeeGraceDays: true } });
  return { amountMinor: school?.lateFeeMinor ?? 0, graceDays: school?.lateFeeGraceDays ?? 0 };
}

/** School Admin: the late-fee policy. Zero switches late fees off. */
export async function saveLateFeePolicy(ctx: TenantContext, input: { amountMinor: number; graceDays: number }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertModuleEnabled(ctx, "FINANCE");
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0 || input.amountMinor > 10_000_000) throw new AppError("VALIDATION", "Enter a late fee between ₹0 and ₹1,00,000.");
  if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > 365) throw new AppError("VALIDATION", "Grace days must be between 0 and 365.");
  await ctx.db.school.update({ where: { id: ctx.schoolId }, data: { lateFeeMinor: input.amountMinor, lateFeeGraceDays: input.graceDays } });
  await recordAudit({
    action: "FEE_SETTINGS_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: input.amountMinor ? `Late fee set to ₹${input.amountMinor / 100} per instalment, ${input.graceDays} day(s) after the due date.` : "Late fees switched off.",
    metadata: { lateFeeMinor: input.amountMinor, lateFeeGraceDays: input.graceDays },
  });
}

/**
 * Add the late fee to every instalment unpaid more than the grace period
 * after its due date (late fees themselves never attract another). Returns
 * how many were added.
 */
export async function applyLateFees(ctx: TenantContext, asOf: Date = today()): Promise<{ added: number; amountMinor: number }> {
  await assertAdminOrStaffPermission(ctx, "fees.manage");
  await assertModuleEnabled(ctx, "FINANCE");
  const { amountMinor, graceDays } = await lateFeePolicy(ctx);
  if (amountMinor <= 0) throw new AppError("VALIDATION", "Late fees are switched off. Set an amount under Late fee policy first.");
  const session = await requireCurrentSession(ctx);
  const cutoff = addDays(asOf, -graceDays);

  const head = await ctx.db.feeHead.upsert({
    where: { schoolId_name: { schoolId: ctx.schoolId, name: LATE_FEE_HEAD } },
    create: { schoolId: ctx.schoolId, name: LATE_FEE_HEAD, isSystem: true, note: "Added by the late-fee policy." },
    update: {},
    select: { id: true },
  });

  const accounts = await loadSessionAccounts(ctx, session.id);
  const existing = await ctx.db.feeCharge.findMany({ where: { academicSessionId: session.id, feeHeadId: head.id }, select: { studentId: true, installmentNo: true, lateFeeForId: true } });
  const charged = new Set(existing.map((row) => row.lateFeeForId));
  const nextNo = new Map<string, number>();
  for (const row of existing) nextNo.set(row.studentId, Math.max(nextNo.get(row.studentId) ?? 0, row.installmentNo));

  let added = 0;
  for (const account of accounts) {
    for (const charge of account.charges) {
      if (charge.isLateFee || charge.remainingMinor <= 0 || !(charge.dueOn < cutoff) || charged.has(charge.id)) continue;
      const installmentNo = (nextNo.get(account.studentId) ?? 0) + 1;
      try {
        await ctx.db.feeCharge.create({
          data: { schoolId: ctx.schoolId, academicSessionId: session.id, studentId: account.studentId, feeHeadId: head.id, installmentNo, amountMinor, dueOn: asOf, lateFeeForId: charge.id, notes: `Late fee: ${charge.head}${charge.installmentNo > 1 ? ` instalment ${charge.installmentNo}` : ""} was due on ${charge.dueOn.toISOString().slice(0, 10)}.` },
        });
        nextNo.set(account.studentId, installmentNo);
        charged.add(charge.id);
        added += 1;
      } catch (error) {
        // Added by someone else a moment ago: one late fee per instalment, never two.
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }

  if (added) {
    await recordAudit({
      action: "FEE_CHARGED",
      entityType: "School",
      entityId: ctx.schoolId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Late fees applied: ${added} instalment(s), ₹${amountMinor / 100} each.`,
      metadata: { lateFees: added, amountMinor, graceDays, asOf: asOf.toISOString().slice(0, 10) },
    });
  }
  return { added, amountMinor: added * amountMinor };
}
