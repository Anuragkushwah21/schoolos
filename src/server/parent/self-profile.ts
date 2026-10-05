import "server-only";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ParentSelfProfileInput } from "@/lib/validation/school";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { phoneKey } from "@/server/people/students";

/**
 * A parent's own record, as they see and correct it under My account.
 *
 * The record is found by the signed-in login, never by an id from the
 * browser, so a parent can only ever reach their own row. What they may
 * change is their name, numbers, occupation and address; the sign-in email,
 * the links to their children, the relationship and ID proof stay with the
 * school office. Every change is audited and stamped, so the office can see
 * that the family updated it.
 */

const PROFILE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  alternatePhone: true,
  occupation: true,
  addressLine: true,
  city: true,
  state: true,
  postalCode: true,
  selfUpdatedAt: true,
  updatedAt: true,
} as const;

const FIELD_LABEL: Record<keyof ParentSelfProfileInput, string> = {
  firstName: "first name",
  lastName: "last name",
  phone: "mobile",
  alternatePhone: "alternate number",
  occupation: "occupation",
  addressLine: "address",
  city: "city",
  state: "state",
  postalCode: "PIN code",
};

export async function getMyParentProfile(ctx: TenantContext) {
  assertRole(ctx.user, "PARENT");
  const parent = await ctx.db.parent.findFirst({ where: { userId: ctx.user.id }, select: PROFILE_SELECT });
  if (!parent) throw new NotFoundError("Your guardian record is not set up yet.");
  // How complete the record is: the things the school needs to reach the family.
  const checks = [parent.phone, parent.alternatePhone, parent.email, parent.occupation, parent.addressLine, parent.city, parent.state, parent.postalCode];
  const filled = checks.filter((value) => Boolean(value && value.trim())).length;
  return { ...parent, completeness: Math.round((filled / checks.length) * 100) };
}

/**
 * Save the parent's own details. A mobile number another parent at this
 * school already uses is refused: the school links brothers and sisters by
 * that number, so sharing it would merge two families.
 */
export async function updateMyParentProfile(ctx: TenantContext, input: ParentSelfProfileInput): Promise<{ changed: string[] }> {
  assertRole(ctx.user, "PARENT");
  const current = await ctx.db.parent.findFirst({ where: { userId: ctx.user.id }, select: { ...PROFILE_SELECT, archivedAt: true } });
  if (!current) throw new NotFoundError("Your guardian record is not set up yet.");
  if (current.archivedAt) throw new ConflictError("This record is archived. Please contact the school office.");

  const changed = (Object.keys(FIELD_LABEL) as Array<keyof ParentSelfProfileInput>).filter((key) => (current[key] ?? null) !== (input[key] ?? null));
  if (!changed.length) return { changed: [] };

  if (changed.includes("phone") && phoneKey(input.phone) !== phoneKey(current.phone)) {
    const others = await ctx.db.parent.findMany({ where: { id: { not: current.id } }, select: { phone: true, alternatePhone: true } });
    if (others.some((row) => phoneKey(row.phone) === phoneKey(input.phone))) {
      throw new ValidationError("Please correct the highlighted fields.", {
        phone: ["Another parent at this school already uses this mobile number. Please contact the school office."],
      });
    }
  }

  await ctx.db.$transaction(async (tx) => {
    await tx.parent.updateMany({ where: { id: current.id, userId: ctx.user.id }, data: { ...input, selfUpdatedAt: new Date() } });
    // The login shows the same name and number everywhere.
    await tx.user.updateMany({ where: { id: ctx.user.id }, data: { firstName: input.firstName, lastName: input.lastName, phone: input.phone } });
  });

  await recordAudit({
    action: "PARENT_SELF_UPDATED",
    entityType: "Parent",
    entityId: current.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${input.firstName} ${input.lastName} updated their own ${changed.map((key) => FIELD_LABEL[key]).join(", ")}.`,
  });
  return { changed: changed.map((key) => FIELD_LABEL[key]) };
}
