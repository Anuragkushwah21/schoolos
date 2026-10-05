import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { addDays, formatDate, today } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { type BaseStaffRole, STAFF_ROLE_NAMES, allowedGrants, cleanGrants, grantDef } from "@/lib/staff-access";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * One staff member covering another's work for a span of days.
 *
 * The substitute gets, on top of their own access, the grants chosen here and
 * — for a driver or attendant — the original's routes, for exactly the days
 * given. Status comes from the dates: scheduled before the start, active
 * through the end date, expired after it, or ended early by the admin. So
 * nothing needs switching off when it is over, and the record stays as
 * history. The original's own grants and routes are never touched.
 *
 * Teachers are covered period by period on Teachers → Cover, which already
 * handles their timetable; this is for non-teaching staff.
 */

export type SubstitutionStatus = "SCHEDULED" | "ACTIVE" | "EXPIRED" | "ENDED";

export function substitutionStatus(row: { startDate: Date; endDate: Date; endedAt: Date | null }, on: Date = today()): SubstitutionStatus {
  if (row.endedAt) return "ENDED";
  if (on < row.startDate) return "SCHEDULED";
  if (on > row.endDate) return "EXPIRED";
  return "ACTIVE";
}

export type SubstitutionInput = {
  substitutionId?: string | null;
  originalStaffId: string;
  substituteStaffId: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  notes: string | null;
  grants: string[];
  coverRoutes: boolean;
};

const MAX_DAYS = 180;
const BACK_DAYS = 30;

const SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  reason: true,
  notes: true,
  grants: true,
  coverRoutes: true,
  endedAt: true,
  createdAt: true,
  original: { select: { id: true, firstName: true, lastName: true, role: true, employeeId: true } },
  substitute: { select: { id: true, firstName: true, lastName: true, role: true, employeeId: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  endedBy: { select: { firstName: true, lastName: true } },
} as const;

/** Create a substitution or change one that has not finished. */
export async function saveSubstitution(ctx: TenantContext, input: SubstitutionInput): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const now = today();
  if (input.originalStaffId === input.substituteStaffId) throw new ValidationError("Please correct the highlighted fields.", { substituteStaffId: ["Choose someone else as the substitute"] });
  if (input.endDate < input.startDate) throw new ValidationError("Please correct the highlighted fields.", { endDate: ["The end date cannot be before the start date"] });
  if (input.startDate < addDays(now, -BACK_DAYS)) throw new ValidationError("Please correct the highlighted fields.", { startDate: [`A substitution can start at most ${BACK_DAYS} days back`] });
  if (input.endDate > addDays(input.startDate, MAX_DAYS)) throw new ValidationError("Please correct the highlighted fields.", { endDate: [`A substitution can last at most ${MAX_DAYS} days`] });

  const [original, substitute] = await Promise.all([
    ctx.db.staffMember.findFirst({ where: { id: input.originalStaffId }, select: { id: true, firstName: true, lastName: true, role: true, status: true, grants: true } }),
    ctx.db.staffMember.findFirst({ where: { id: input.substituteStaffId }, select: { id: true, firstName: true, lastName: true, role: true, status: true } }),
  ]);
  if (!original) throw new NotFoundError("That staff member was not found.");
  if (!substitute) throw new NotFoundError("The substitute was not found.");
  if (substitute.status !== "ACTIVE") throw new ConflictError(`${fullName(substitute)} is not active, so cannot cover for anyone.`);

  // A substitute may only be lent what their own designation could ever hold.
  const wanted = cleanGrants(input.grants);
  const allowed = allowedGrants(substitute.role, wanted);
  const refused = wanted.filter((key) => !allowed.includes(key));
  if (refused.length) {
    throw new ValidationError("Please correct the highlighted fields.", {
      grants: [
        `A ${STAFF_ROLE_NAMES[substitute.role as BaseStaffRole].toLowerCase()} can never have: ${refused.map((key) => grantDef(key)?.label ?? key).join(", ")}. Choose a substitute whose role allows it, or untick these.`,
      ],
    });
  }

  const existing = input.substitutionId ? await ctx.db.staffSubstitution.findFirst({ where: { id: input.substitutionId }, select: { id: true, startDate: true, endDate: true, endedAt: true } }) : null;
  if (input.substitutionId && !existing) throw new NotFoundError("That substitution was not found.");
  if (existing && ["ENDED", "EXPIRED"].includes(substitutionStatus(existing))) throw new ConflictError("A finished substitution cannot be changed. Add a new one.");

  // The same person cannot be booked twice over the same days for the same colleague.
  const overlap = await ctx.db.staffSubstitution.findFirst({
    where: {
      id: existing ? { not: existing.id } : undefined,
      originalStaffId: original.id,
      substituteStaffId: substitute.id,
      endedAt: null,
      startDate: { lte: input.endDate },
      endDate: { gte: input.startDate },
    },
    select: { startDate: true, endDate: true },
  });
  if (overlap) throw new ConflictError(`${fullName(substitute)} already covers for ${fullName(original)} from ${formatDate(overlap.startDate)} to ${formatDate(overlap.endDate)}.`);

  const data = {
    originalStaffId: original.id,
    substituteStaffId: substitute.id,
    startDate: input.startDate,
    endDate: input.endDate,
    reason: input.reason.trim(),
    notes: input.notes?.trim() || null,
    grants: allowed,
    coverRoutes: input.coverRoutes,
  };
  let id: string;
  if (existing) {
    await ctx.db.staffSubstitution.updateMany({ where: { id: existing.id }, data });
    id = existing.id;
  } else {
    id = (await ctx.db.staffSubstitution.create({ data: { ...data, schoolId: ctx.schoolId, createdById: ctx.user.id }, select: { id: true } })).id;
  }
  const summary = `${fullName(substitute)} covers for ${fullName(original)} ${formatDate(input.startDate)} – ${formatDate(input.endDate)}${allowed.length ? ` with: ${allowed.map((key) => grantDef(key)?.label ?? key).join(", ")}` : ""}.`;
  for (const entityId of [original.id, substitute.id]) {
    await recordAudit({ action: "STAFF_SUBSTITUTION_SAVED", entityType: "StaffMember", entityId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary });
  }
  return { id };
}

/** End a substitution today: the substitute loses the temporary access at once. The record stays. */
export async function endSubstitution(ctx: TenantContext, substitutionId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await ctx.db.staffSubstitution.findFirst({ where: { id: substitutionId }, select: { ...SELECT } });
  if (!row) throw new NotFoundError("That substitution was not found.");
  const status = substitutionStatus(row);
  if (status === "ENDED" || status === "EXPIRED") throw new ConflictError("That substitution has already finished.");
  await ctx.db.staffSubstitution.updateMany({ where: { id: row.id, endedAt: null }, data: { endedAt: new Date(), endedById: ctx.user.id } });
  const summary = `${fullName(row.substitute)} no longer covers for ${fullName(row.original)} (ended early).`;
  for (const entityId of [row.original.id, row.substitute.id]) {
    await recordAudit({ action: "STAFF_SUBSTITUTION_ENDED", entityType: "StaffMember", entityId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary });
  }
}

function shape(row: Awaited<ReturnType<typeof loadRows>>[number], on: Date) {
  return {
    ...row,
    grants: cleanGrants(row.grants),
    status: substitutionStatus(row, on),
    original: { ...row.original, name: fullName(row.original) },
    substitute: { ...row.substitute, name: fullName(row.substitute) },
    createdBy: row.createdBy ? fullName(row.createdBy) : null,
    endedBy: row.endedBy ? fullName(row.endedBy) : null,
  };
}

function loadRows(ctx: TenantContext, where: Prisma.StaffSubstitutionWhereInput, take = 100) {
  return ctx.db.staffSubstitution.findMany({ where, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }], take, select: SELECT });
}

/** One staff member's substitutions: covered by others, and covering for others. */
export async function substitutionsFor(ctx: TenantContext, staffId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const now = today();
  const [coveredBy, covering] = await Promise.all([loadRows(ctx, { originalStaffId: staffId }), loadRows(ctx, { substituteStaffId: staffId })]);
  return { coveredBy: coveredBy.map((row) => shape(row, now)), covering: covering.map((row) => shape(row, now)) };
}

/** Every substitution, filtered by status, newest first — the history list. */
export async function listSubstitutions(ctx: TenantContext, filters: { status?: SubstitutionStatus } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const now = today();
  const where =
    filters.status === "ACTIVE"
      ? { endedAt: null, startDate: { lte: now }, endDate: { gte: now } }
      : filters.status === "SCHEDULED"
        ? { endedAt: null, startDate: { gt: now } }
        : filters.status === "EXPIRED"
          ? { endedAt: null, endDate: { lt: now } }
          : filters.status === "ENDED"
            ? { endedAt: { not: null } }
            : {};
  return (await loadRows(ctx, where, 200)).map((row) => shape(row, now));
}

/** Current staff who could cover for this person: everyone active except them, with whether their role fits. */
export async function substituteCandidates(ctx: TenantContext, originalStaffId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const original = await ctx.db.staffMember.findFirst({ where: { id: originalStaffId }, select: { id: true, role: true, grants: true } });
  if (!original) throw new NotFoundError("That staff member was not found.");
  const staff = await ctx.db.staffMember.findMany({
    where: { id: { not: original.id }, status: "ACTIVE" },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, role: true, roleProfile: { select: { name: true } } },
  });
  const needed = cleanGrants(original.grants);
  return staff.map((person) => {
    const missing = needed.filter((key) => !allowedGrants(person.role, [key]).length);
    return {
      id: person.id,
      name: fullName(person),
      role: person.roleProfile?.name ?? STAFF_ROLE_NAMES[person.role as BaseStaffRole],
      sameRole: person.role === original.role,
      /** Grants of the original this person's role could never hold. */
      cannotHold: missing,
    };
  });
}
