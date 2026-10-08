import "server-only";

import type { TransportTrip, TransportTripStatus } from "@/generated/prisma/enums";
import { addDays, today } from "@/lib/dates";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { groupLabel } from "@/server/academics/streams";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { activeSubstitutionsAsSubstitute, assertStaffGrant, requireStaffSelf, staffHolds } from "@/server/auth/staff-access";
import { assertModuleEnabled } from "@/server/platform/modules";

/**
 * A driver's or attendant's own transport work.
 *
 * Everything here is scoped to the routes this person is on: the ones they
 * drive or attend, plus — while a substitution is active — the routes of the
 * colleague they cover for. A grant opens the feature ("Students on my
 * route"); the scope decides which rows come back. Holding a grant never
 * reaches another route's students, and nothing here works across schools.
 */

export type RouteRole = "DRIVER" | "ATTENDANT" | "SUBSTITUTE";
type ScopedRoute = { routeId: string; as: RouteRole; coveringFor?: string; until?: Date };

/** The routes this staff member works today, and in what capacity. */
export async function myRouteScope(ctx: TenantContext): Promise<ScopedRoute[]> {
  const staff = await requireStaffSelf(ctx);
  const [own, substitutions] = await Promise.all([
    ctx.db.transportRoute.findMany({ where: { isActive: true, OR: [{ driverId: staff.id }, { attendantId: staff.id }] }, select: { id: true, driverId: true } }),
    activeSubstitutionsAsSubstitute(ctx, staff.id),
  ]);
  const scope = new Map<string, ScopedRoute>(own.map((route) => [route.id, { routeId: route.id, as: route.driverId === staff.id ? "DRIVER" : "ATTENDANT" }]));
  const covering = substitutions.filter((row) => row.coverRoutes);
  if (covering.length) {
    const theirs = await ctx.db.transportRoute.findMany({
      where: { isActive: true, OR: covering.flatMap((row) => [{ driverId: row.originalStaffId }, { attendantId: row.originalStaffId }]) },
      select: { id: true, driverId: true, attendantId: true },
    });
    for (const route of theirs) {
      if (scope.has(route.id)) continue;
      const sub = covering.find((row) => row.originalStaffId === route.driverId || row.originalStaffId === route.attendantId)!;
      scope.set(route.id, { routeId: route.id, as: "SUBSTITUTE", coveringFor: fullName(sub.original), until: sub.endDate });
    }
  }
  return [...scope.values()];
}

/** Throws unless this route is one of the signed-in staff member's routes today. */
async function assertMyRoute(ctx: TenantContext, routeId: string): Promise<ScopedRoute> {
  const scoped = (await myRouteScope(ctx)).find((row) => row.routeId === routeId);
  // Not "not found": the route may exist; it simply is not theirs.
  if (!scoped) throw new ForbiddenError("That route is not one of yours.");
  return scoped;
}

/** Whether a student rides one of the signed-in staff member's routes (for photos). */
export async function studentOnMyRoutes(ctx: TenantContext, studentId: string): Promise<boolean> {
  if (ctx.user.role !== "NON_TEACHING_STAFF") return false;
  const routeIds = (await myRouteScope(ctx)).map((row) => row.routeId);
  if (!routeIds.length) return false;
  return (await ctx.db.studentTransport.count({ where: { studentId, routeId: { in: routeIds }, status: "ACTIVE" } })) > 0;
}

/** Whether the signed-in staff member has a route today — for the "My route" link. */
export async function hasAssignedRoute(ctx: TenantContext): Promise<boolean> {
  if (ctx.user.role !== "NON_TEACHING_STAFF") return false;
  if (!(await staffHolds(ctx, "transport.myroute"))) return false;
  return (await myRouteScope(ctx)).length > 0;
}

/**
 * The routes this person works: number, start → end, vehicle, the other crew
 * member, notes, and the stops in order with how many students board at
 * each. Counts only — names need "Students on my route".
 */
export async function myAssignedRoutes(ctx: TenantContext) {
  await assertStaffGrant(ctx, "transport.myroute");
  const scope = await myRouteScope(ctx);
  if (!scope.length) return [];
  const staff = await requireStaffSelf(ctx);
  const routes = await ctx.db.transportRoute.findMany({
    where: { id: { in: scope.map((row) => row.routeId) } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      startPoint: true,
      endPoint: true,
      notes: true,
      driverId: true,
      driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
      attendant: { select: { id: true, firstName: true, lastName: true, phone: true } },
      vehicle: { select: { registrationNo: true, type: true, capacity: true, status: true } },
      stops: {
        orderBy: { sequence: "asc" },
        select: { id: true, name: true, location: true, sequence: true, pickupMinute: true, dropMinute: true, _count: { select: { students: { where: { status: "ACTIVE" } } } } },
      },
      _count: { select: { students: { where: { status: "ACTIVE" } } } },
    },
  });
  return routes.map(({ driverId, _count, driver, attendant, stops, ...route }) => {
    const scoped = scope.find((row) => row.routeId === route.id)!;
    // The other people on the bus, so they can reach each other.
    const crew = [driver && driver.id !== staff.id ? { role: "Driver", name: fullName(driver), phone: driver.phone } : null, attendant && attendant.id !== staff.id ? { role: "Attendant", name: fullName(attendant), phone: attendant.phone } : null].filter(
      (row): row is { role: string; name: string; phone: string | null } => row !== null,
    );
    void driverId;
    return {
      ...route,
      as: scoped.as,
      coveringFor: scoped.coveringFor ?? null,
      until: scoped.until ?? null,
      riders: _count.students,
      crew,
      stops: stops.map(({ _count: count, ...stop }) => ({ ...stop, riders: count.students })),
      /** Students on the route with no stop set. */
      unassignedRiders: _count.students - stops.reduce((sum, stop) => sum + stop._count.students, 0),
    };
  });
}

/**
 * The students on one of my routes (optionally one stop), with class,
 * section, stop and times, and today's pickup and drop status. The guardian
 * contact is included only with "Emergency contact of my riders".
 */
export async function myRouteRiders(ctx: TenantContext, routeId: string, filters: { stopId?: string | null } = {}) {
  await assertStaffGrant(ctx, "transport.riders");
  const scoped = await assertMyRoute(ctx, routeId);
  const withContacts = await staffHolds(ctx, "transport.contacts");
  const date = today();
  const [rows, logs] = await Promise.all([
    ctx.db.studentTransport.findMany({
      where: { routeId, status: "ACTIVE", ...(filters.stopId ? { stopId: filters.stopId } : {}) },
      orderBy: [{ stop: { sequence: "asc" } }, { student: { firstName: "asc" } }],
      select: {
        studentId: true,
        stop: { select: { id: true, name: true, sequence: true, pickupMinute: true, dropMinute: true } },
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNumber: true,
            enrollments: {
              where: { academicSession: { isCurrent: true } },
              take: 1,
              select: { rollNumber: true, stream: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
            },
            // Guardian contact only with "Emergency contact of my riders": none is even read otherwise.
            parents: { orderBy: { isPrimary: "desc" }, take: withContacts ? 1 : 0, select: { relationship: true, parent: { select: { firstName: true, lastName: true, phone: true, alternatePhone: true } } } },
          },
        },
      },
    }),
    ctx.db.transportTripLog.findMany({ where: { routeId, date }, select: { studentId: true, trip: true, status: true, note: true, markedAt: true } }),
  ]);
  return {
    as: scoped.as,
    coveringFor: scoped.coveringFor ?? null,
    withContacts,
    riders: rows.map((row) => {
      const placement = row.student.enrollments[0];
      const guardianLink = row.student.parents[0];
      const log = (trip: TransportTrip) => logs.find((entry) => entry.studentId === row.studentId && entry.trip === trip) ?? null;
      return {
        studentId: row.studentId,
        name: fullName(row.student),
        admissionNumber: row.student.admissionNumber,
        className: placement?.section.class.name ?? null,
        section: placement ? groupLabel(placement.section, placement.stream) : null,
        stop: row.stop,
        guardian: withContacts && guardianLink ? { name: fullName(guardianLink.parent), relationship: guardianLink.relationship, phone: guardianLink.parent.phone, alternatePhone: guardianLink.parent.alternatePhone } : null,
        pickup: log("PICKUP"),
        drop: log("DROP"),
      };
    }),
  };
}

const ALLOWED: Record<TransportTrip, TransportTripStatus[]> = {
  PICKUP: ["PICKED_UP", "NOT_PRESENT", "ISSUE"],
  DROP: ["DROPPED", "NOT_PRESENT", "ISSUE"],
};

/**
 * Mark one student's pickup or drop today. The student must ride this route
 * and the route must be one of mine. Marking again replaces today's mark.
 */
export async function markTrip(ctx: TenantContext, input: { routeId: string; studentId: string; trip: TransportTrip; status: TransportTripStatus; note?: string | null }) {
  // The School Admin may mark or correct any route's trip; a driver or
  // attendant only their own route's (or the one they cover today).
  if (ctx.user.role !== "SCHOOL_ADMIN") {
    await assertStaffGrant(ctx, "transport.trips");
    await assertMyRoute(ctx, input.routeId);
  }
  if (!ALLOWED[input.trip].includes(input.status)) throw new AppError("VALIDATION", "That status does not apply to this trip.");
  if (input.status === "ISSUE" && !input.note?.trim()) throw new AppError("VALIDATION", "Say what the issue is.");
  const ride = await ctx.db.studentTransport.findFirst({ where: { routeId: input.routeId, studentId: input.studentId, status: "ACTIVE" }, select: { stopId: true } });
  if (!ride) throw new NotFoundError("That student is not on this route.");
  const date = today();
  const data = { status: input.status, note: input.note?.trim() || null, stopId: ride.stopId, markedById: ctx.user.id, markedAt: new Date() };
  const before = await ctx.db.transportTripLog.findFirst({ where: { date, studentId: input.studentId, trip: input.trip }, select: { status: true } });
  const log = await ctx.db.transportTripLog.upsert({
    where: { schoolId_date_studentId_trip: { schoolId: ctx.schoolId, date, studentId: input.studentId, trip: input.trip } },
    create: { schoolId: ctx.schoolId, date, routeId: input.routeId, studentId: input.studentId, trip: input.trip, ...data },
    update: { routeId: input.routeId, ...data },
    select: { id: true, student: { select: { firstName: true, lastName: true } }, route: { select: { name: true } } },
  });
  await recordAudit({
    action: "TRANSPORT_TRIP_MARKED",
    entityType: "TransportTripLog",
    entityId: log.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${input.trip === "PICKUP" ? "Pickup" : "Drop"} for ${fullName(log.student)} on ${log.route.name}: ${input.status.toLowerCase().replace("_", " ")}${before && before.status !== input.status ? ` (was ${before.status.toLowerCase().replace("_", " ")})` : ""}.`,
  });
}

/** Report something wrong on my route today — a breakdown, a road closed. The office sees it on the route. */
export async function reportRouteIssue(ctx: TenantContext, input: { routeId: string; note: string }): Promise<void> {
  await assertStaffGrant(ctx, "transport.myroute");
  await assertMyRoute(ctx, input.routeId);
  const note = input.note.trim();
  if (note.length < 3) throw new AppError("VALIDATION", "Describe the issue.");
  const route = await ctx.db.transportRoute.findFirst({ where: { id: input.routeId }, select: { name: true } });
  await ctx.db.transportIssue.create({ data: { schoolId: ctx.schoolId, routeId: input.routeId, date: today(), note: note.slice(0, 500), reportedById: ctx.user.id } });
  await recordAudit({ action: "TRANSPORT_UPDATED", entityType: "TransportRoute", entityId: input.routeId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Issue reported on ${route?.name ?? "a route"}: ${note.slice(0, 120)}` });
}

/** The last days on one of my routes: how many were picked up, not present, dropped, and any issues. */
export async function myRouteHistory(ctx: TenantContext, routeId: string, days = 14) {
  await assertStaffGrant(ctx, "transport.myroute");
  await assertMyRoute(ctx, routeId);
  return routeDays(ctx, routeId, days);
}

async function routeDays(ctx: TenantContext, routeId: string, days: number) {
  const from = addDays(today(), -(days - 1));
  const [logs, issues] = await Promise.all([
    ctx.db.transportTripLog.groupBy({ by: ["date", "trip", "status"], where: { routeId, date: { gte: from } }, _count: true }),
    ctx.db.transportIssue.findMany({ where: { routeId, date: { gte: from } }, orderBy: { createdAt: "desc" }, select: { id: true, date: true, note: true, createdAt: true, reportedBy: { select: { firstName: true, lastName: true } } } }),
  ]);
  const byDate = new Map<string, { date: Date; pickedUp: number; notPresent: number; dropped: number; issues: number; notes: string[] }>();
  const day = (date: Date) => {
    const key = date.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, { date, pickedUp: 0, notPresent: 0, dropped: 0, issues: 0, notes: [] });
    return byDate.get(key)!;
  };
  for (const row of logs) {
    const entry = day(row.date);
    if (row.status === "PICKED_UP") entry.pickedUp += row._count;
    if (row.status === "DROPPED") entry.dropped += row._count;
    if (row.status === "NOT_PRESENT" && row.trip === "PICKUP") entry.notPresent += row._count;
    if (row.status === "ISSUE") entry.issues += row._count;
  }
  for (const issue of issues) {
    const entry = day(issue.date);
    entry.issues += 1;
    entry.notes.push(`${issue.note}${issue.reportedBy ? ` — ${fullName(issue.reportedBy)}` : ""}`);
  }
  return [...byDate.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** The School Admin's view of a route's last days and reported issues. */
export async function routeActivity(ctx: TenantContext, routeId: string, days = 14) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertModuleEnabled(ctx, "TRANSPORT");
  const route = await ctx.db.transportRoute.findFirst({ where: { id: routeId }, select: { id: true } });
  if (!route) throw new NotFoundError("That route was not found.");
  const date = today();
  const [history, todayLogs] = await Promise.all([
    routeDays(ctx, routeId, days),
    ctx.db.transportTripLog.findMany({
      where: { routeId, date },
      orderBy: { markedAt: "desc" },
      select: { trip: true, status: true, note: true, markedAt: true, student: { select: { firstName: true, lastName: true } }, markedBy: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  return { history, today: todayLogs.map((row) => ({ ...row, student: fullName(row.student), markedBy: row.markedBy ? fullName(row.markedBy) : null })) };
}
