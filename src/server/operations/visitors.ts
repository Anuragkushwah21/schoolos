import "server-only";

import type { VisitorStatus } from "@/generated/prisma/enums";
import { addDays, formatSchoolTime, schoolInstant, today } from "@/lib/dates";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { VisitorEntryInput, VisitorUpdateInput } from "@/lib/validation/visitors";
import { recordAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/current-user";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";

/**
 * Visitors at the gate: name, mobile, purpose, whom they came to meet, vehicle,
 * entry and exit. Deliberately simple — no gate hardware, passes or photos.
 *
 * The School Admin has it all; staff need "Visitor log" to read it and
 * "Record visitor entry & exit" to write it (security's defaults). Nothing
 * here reads students' studies, fees or marks. Every entry, exit and
 * correction is audited; a visit is never deleted.
 */

const VIEW = ["visitors.view", "visitors.manage"] as const;

const VISITOR_SELECT = {
  id: true,
  name: true,
  phone: true,
  purpose: true,
  personToMeet: true,
  vehicleNo: true,
  entryAt: true,
  exitAt: true,
  status: true,
  notes: true,
  recordedBy: { select: { firstName: true, lastName: true } },
} as const;


/**
 * The log for one day (default today), newest first — plus everyone still
 * inside from earlier days, so nobody is forgotten on campus.
 */
export async function listVisitors(ctx: TenantContext, filters: { date?: Date | null; q?: string | null; status?: VisitorStatus | null } = {}) {
  await assertAdminOrStaffPermission(ctx, [...VIEW]);
  const day = filters.date ?? today();
  const from = schoolInstant(day, 0);
  const to = schoolInstant(addDays(day, 1), 0);
  const q = filters.q?.trim();
  const rows = await ctx.db.visitor.findMany({
    where: {
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { personToMeet: { contains: q, mode: "insensitive" } }, { vehicleNo: { contains: q, mode: "insensitive" } }] }
        : { OR: [{ entryAt: { gte: from, lt: to } }, { status: "INSIDE", entryAt: { lt: from } }] }),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { entryAt: "desc" },
    take: 300,
    select: VISITOR_SELECT,
  });
  const [inside, todayCount] = await Promise.all([
    ctx.db.visitor.count({ where: { status: "INSIDE" } }),
    ctx.db.visitor.count({ where: { entryAt: { gte: schoolInstant(today(), 0) } } }),
  ]);
  return { day, rows, inside, today: todayCount };
}

/**
 * Log a visitor in (or as turned away), stamped with the moment it is saved:
 * a visitor is logged as they arrive, so no other day or time can be entered.
 */
export async function recordVisitorEntry(ctx: TenantContext, input: VisitorEntryInput): Promise<string> {
  await assertAdminOrStaffPermission(ctx, "visitors.manage");
  const entryAt = new Date();
  const row = await ctx.db.visitor.create({
    data: {
      schoolId: ctx.schoolId,
      name: input.name,
      phone: input.phone,
      purpose: input.purpose,
      personToMeet: input.personToMeet,
      vehicleNo: input.vehicleNo,
      notes: input.notes,
      entryAt,
      // Turned away: never inside, so the visit is closed at once.
      status: input.denied ? "DENIED" : "INSIDE",
      exitAt: input.denied ? entryAt : null,
      recordedById: ctx.user.id,
    },
    select: { id: true },
  });
  await recordAudit({
    action: "VISITOR_ENTERED",
    entityType: "Visitor",
    entityId: row.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${input.denied ? "Visitor turned away" : "Visitor in"}: ${input.name}, to meet ${input.personToMeet} (${input.purpose}) at ${formatSchoolTime(entryAt)}${input.vehicleNo ? `, vehicle ${input.vehicleNo}` : ""}.`,
  });
  return row.id;
}

/** Mark a visitor out, stamped with the moment it is saved. */
export async function markVisitorExit(ctx: TenantContext, input: { visitorId: string }): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "visitors.manage");
  const visitor = await ctx.db.visitor.findFirst({ where: { id: input.visitorId }, select: { id: true, name: true, status: true, entryAt: true } });
  if (!visitor) throw new NotFoundError("That visitor was not found.");
  if (visitor.status !== "INSIDE") throw new ConflictError(`${visitor.name} is not marked inside.`);
  // "Now" a moment before an entry logged with clock drift is still the entry moment.
  const now = new Date();
  const exitAt = now < visitor.entryAt ? visitor.entryAt : now;
  const { count } = await ctx.db.visitor.updateMany({ where: { id: visitor.id, status: "INSIDE" }, data: { status: "LEFT", exitAt } });
  if (!count) throw new ConflictError(`${visitor.name} was marked out a moment ago.`);
  await recordAudit({
    action: "VISITOR_EXITED",
    entityType: "Visitor",
    entityId: visitor.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Visitor out: ${visitor.name} at ${formatSchoolTime(exitAt)}.`,
  });
}

/**
 * Correct a visit's details or status. The entry and exit times are never
 * typed in: they stay as stamped, and a visitor set to Left now is out now.
 * The audit entry lists what changed, with old and new values.
 */
export async function updateVisitor(ctx: TenantContext, input: VisitorUpdateInput): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "visitors.manage");
  const before = await ctx.db.visitor.findFirst({ where: { id: input.visitorId }, select: VISITOR_SELECT });
  if (!before) throw new NotFoundError("That visitor was not found.");
  const entryAt = before.entryAt;
  const exitAt = input.status === "INSIDE" ? null : (before.exitAt ?? (input.status === "DENIED" ? entryAt : new Date()));
  const after = { name: input.name, phone: input.phone, purpose: input.purpose, personToMeet: input.personToMeet, vehicleNo: input.vehicleNo, notes: input.notes, entryAt, exitAt, status: input.status };
  const show = (value: unknown) => (value instanceof Date ? formatSchoolTime(value) : value === null || value === undefined || value === "" ? "—" : String(value));
  const changes = (Object.keys(after) as Array<keyof typeof after>)
    .filter((key) => show(before[key]) !== show(after[key]) || (before[key] instanceof Date && after[key] instanceof Date && (before[key] as Date).getTime() !== (after[key] as Date).getTime()))
    .map((key) => `${key}: ${show(before[key])} → ${show(after[key])}`);
  if (!changes.length) return;
  await ctx.db.visitor.updateMany({ where: { id: before.id }, data: after });
  await recordAudit({
    action: "VISITOR_UPDATED",
    entityType: "Visitor",
    entityId: before.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Visitor ${before.name} corrected: ${changes.join("; ")}.`,
    metadata: { changes },
  });
}
