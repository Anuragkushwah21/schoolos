import "server-only";

import { cache } from "react";

import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { type GradingRules, checkBands, rulesFrom } from "@/lib/grades";
import { recordAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";
import { prisma } from "@/server/db/prisma";

/**
 * The school's grading rules (scale and default pass percentage), read once
 * per request. Every result — exam tables, report cards, parent and student
 * views — goes through these, so a change applies everywhere at once and
 * nothing stored has to be rewritten.
 */
export const gradingRulesOf = cache(async (schoolId: string): Promise<GradingRules> => {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { gradeBands: true, passPercent: true } });
  return rulesFrom(school);
});

export async function gradingRules(ctx: { schoolId: string }): Promise<GradingRules> {
  return gradingRulesOf(ctx.schoolId);
}

/** School Admin (settings): set the scale and default pass percentage. `bands: null` returns to the CBSE default. */
export async function saveGradingRules(ctx: TenantContext, input: { bands: Array<{ min: number; grade: string }> | null; passPercent: number }): Promise<void> {
  assertCan(ctx, "settings", "EDIT");
  if (!Number.isInteger(input.passPercent) || input.passPercent < 1 || input.passPercent > 100) throw new AppError("VALIDATION", "The pass percentage must be a whole number from 1 to 100.");
  let bands: Array<{ min: number; grade: string }> | null = null;
  if (input.bands) {
    const checked = checkBands(input.bands);
    if (!checked.ok) throw new AppError("VALIDATION", checked.reason);
    bands = checked.bands;
  }
  const before = await prisma.school.findUnique({ where: { id: ctx.schoolId }, select: { gradeBands: true, passPercent: true } });
  await prisma.school.update({ where: { id: ctx.schoolId }, data: { gradeBands: bands ?? Prisma.DbNull, passPercent: input.passPercent } });
  await recordAudit({
    action: "GRADING_RULES_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Grading rules updated: ${bands ? bands.map((band) => `${band.grade} ≥${band.min}%`).join(", ") : "CBSE nine-point scale"}; pass at ${input.passPercent}%.`,
    metadata: { previous: before, next: { gradeBands: bands, passPercent: input.passPercent } },
  });
}
