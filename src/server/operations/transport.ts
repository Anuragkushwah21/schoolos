import "server-only";

import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { formatMinutes, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import type { AssignTransportInput, RouteInput, StopInput, VehicleInput } from "@/lib/validation/operations";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { isUniqueViolation } from "@/server/db/errors";
import type { ReportTable } from "@/server/reports/exports";

/**
 * Transport: vehicles, routes with ordered stops, the driver and attendant of
 * each route (non-teaching staff), and which student rides which route.
 *
 * School Admin manages everything. A parent sees only their own child's route
 * and stop (`childTransport`). No live GPS in this phase.
 */

async function audit(ctx: TenantContext, action: "TRANSPORT_UPDATED" | "TRANSPORT_ASSIGNED", summary: string, entityId: string | null = null) {
  await recordAudit({ action, entityType: "Transport", entityId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary });
}

// --- vehicles ----------------------------------------------------------------

export async function listVehicles(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.vehicle.findMany({
    orderBy: { registrationNo: "asc" },
    select: { id: true, registrationNo: true, type: true, capacity: true, status: true, notes: true, routes: { select: { id: true, name: true } } },
  });
}

export async function saveVehicle(ctx: TenantContext, input: VehicleInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { vehicleId, ...data } = input;
  try {
    let id: string;
    if (vehicleId) {
      const { count } = await ctx.db.vehicle.updateMany({ where: { id: vehicleId }, data });
      if (!count) throw new NotFoundError("That vehicle was not found.");
      id = vehicleId;
    } else {
      id = (await ctx.db.vehicle.create({ data: { ...data, schoolId: ctx.schoolId }, select: { id: true } })).id;
    }
    await audit(ctx, "TRANSPORT_UPDATED", `Vehicle ${data.registrationNo} ${vehicleId ? "updated" : "added"}.`, id);
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A vehicle with that registration number already exists.");
    throw error;
  }
}

// --- routes and stops ----------------------------------------------------------

export async function listRoutes(ctx: TenantContext) {
  // The School Admin, or staff the admin has let see this (read-only).
  await assertAdminOrStaffPermission(ctx, "VIEW_TRANSPORT");
  const routes = await ctx.db.transportRoute.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      isActive: true,
      notes: true,
      vehicle: { select: { id: true, registrationNo: true, capacity: true } },
      driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
      attendant: { select: { id: true, firstName: true, lastName: true, phone: true } },
      stops: { orderBy: { sequence: "asc" }, select: { id: true, name: true, sequence: true, pickupMinute: true, dropMinute: true } },
      _count: { select: { students: { where: { status: "ACTIVE" } } } },
    },
  });
  return routes.map((route) => ({
    ...route,
    riders: route._count.students,
    /** Seats used on the route's vehicle, or null with no vehicle. */
    utilisation: route.vehicle ? route._count.students / route.vehicle.capacity : null,
  }));
}

/**
 * The vehicle, driver and attendant must be this school's; a driver must be a
 * DRIVER and an attendant a TRANSPORT_ATTENDANT. One vehicle serves one route.
 */
export async function saveRoute(ctx: TenantContext, input: RouteInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { routeId, ...data } = input;
  const [vehicle, driver, attendant] = await Promise.all([
    data.vehicleId ? ctx.db.vehicle.findFirst({ where: { id: data.vehicleId }, select: { id: true, routes: { select: { id: true, name: true } } } }) : null,
    data.driverId ? ctx.db.staffMember.findFirst({ where: { id: data.driverId, role: "DRIVER" }, select: { id: true } }) : null,
    data.attendantId ? ctx.db.staffMember.findFirst({ where: { id: data.attendantId, role: "TRANSPORT_ATTENDANT" }, select: { id: true } }) : null,
  ]);
  if (data.vehicleId && !vehicle) throw new NotFoundError("That vehicle was not found.");
  if (data.driverId && !driver) throw new NotFoundError("That driver was not found (choose a staff member with the Driver role).");
  if (data.attendantId && !attendant) throw new NotFoundError("That attendant was not found (choose a Transport attendant).");
  const otherRoute = vehicle?.routes.find((route) => route.id !== routeId);
  if (otherRoute) throw new ConflictError(`That vehicle already serves ${otherRoute.name}.`);

  try {
    let id: string;
    if (routeId) {
      const { count } = await ctx.db.transportRoute.updateMany({ where: { id: routeId }, data });
      if (!count) throw new NotFoundError("That route was not found.");
      id = routeId;
    } else {
      id = (await ctx.db.transportRoute.create({ data: { ...data, schoolId: ctx.schoolId }, select: { id: true } })).id;
    }
    await audit(ctx, "TRANSPORT_UPDATED", `Route ${data.name} ${routeId ? "updated" : "created"}.`, id);
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A route with that name already exists.");
    throw error;
  }
}

export async function addStop(ctx: TenantContext, input: StopInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const route = await ctx.db.transportRoute.findFirst({ where: { id: input.routeId }, select: { id: true, name: true } });
  if (!route) throw new NotFoundError("That route was not found.");
  if (input.pickupMinute !== null && input.dropMinute !== null && input.dropMinute <= input.pickupMinute) {
    throw new AppError("VALIDATION", "Drop time must be after pickup time.");
  }
  try {
    await ctx.db.routeStop.create({ data: { ...input, schoolId: ctx.schoolId } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Stop number ${input.sequence} already exists on ${route.name}.`);
    throw error;
  }
  await audit(ctx, "TRANSPORT_UPDATED", `Stop ${input.name} added to ${route.name}.`, route.id);
}

export async function removeStop(ctx: TenantContext, stopId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const stop = await ctx.db.routeStop.findFirst({ where: { id: stopId }, select: { id: true, name: true, _count: { select: { students: true } } } });
  if (!stop) throw new NotFoundError("That stop was not found.");
  if (stop._count.students) throw new ConflictError(`${stop._count.students} students board at ${stop.name}. Move them first.`);
  await ctx.db.routeStop.deleteMany({ where: { id: stop.id } });
}

// --- students ----------------------------------------------------------------

/**
 * Put students on a route (and stop). A student already on another route is
 * moved; the vehicle's capacity is checked for the whole batch.
 */
export async function assignTransport(ctx: TenantContext, input: AssignTransportInput): Promise<{ assigned: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const route = await ctx.db.transportRoute.findFirst({
    where: { id: input.routeId },
    select: { id: true, name: true, isActive: true, vehicle: { select: { capacity: true } }, stops: { select: { id: true } } },
  });
  if (!route) throw new NotFoundError("That route was not found.");
  if (!route.isActive) throw new AppError("VALIDATION", `${route.name} is not active.`);
  if (input.stopId && !route.stops.some((stop) => stop.id === input.stopId)) throw new NotFoundError("That stop is not on this route.");

  const ids = [...new Set(input.studentIds)];
  const students = await ctx.db.student.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true } });
  if (students.length !== ids.length) throw new NotFoundError("One or more students were not found or are not active.");

  if (route.vehicle) {
    const riding = await ctx.db.studentTransport.count({ where: { routeId: route.id, status: "ACTIVE", studentId: { notIn: ids } } });
    if (riding + ids.length > route.vehicle.capacity) {
      throw new ConflictError(`${route.name}'s vehicle seats ${route.vehicle.capacity}; ${riding} already ride it, so ${Math.max(route.vehicle.capacity - riding, 0)} more fit.`);
    }
  }

  await ctx.db.$transaction(
    ids.map((studentId) =>
      ctx.db.studentTransport.upsert({
        where: { schoolId_studentId: { schoolId: ctx.schoolId, studentId } },
        create: { schoolId: ctx.schoolId, studentId, routeId: route.id, stopId: input.stopId, startDate: input.startDate },
        update: { routeId: route.id, stopId: input.stopId, startDate: input.startDate, status: "ACTIVE" },
      }),
    ),
  );
  await audit(ctx, "TRANSPORT_ASSIGNED", `${ids.length} student${ids.length === 1 ? "" : "s"} assigned to ${route.name}.`, route.id);
  return { assigned: ids.length };
}

export async function removeTransport(ctx: TenantContext, studentId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.studentTransport.deleteMany({ where: { studentId } });
  if (!count) throw new NotFoundError("That student is not on a route.");
  await audit(ctx, "TRANSPORT_ASSIGNED", "A student was taken off transport.", studentId);
}

export async function routeRiders(ctx: TenantContext, routeId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.studentTransport.findMany({
    where: { routeId },
    orderBy: [{ stop: { sequence: "asc" } }, { student: { firstName: "asc" } }],
    select: {
      id: true,
      status: true,
      startDate: true,
      stop: { select: { name: true, pickupMinute: true } },
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          enrollments: { where: { academicSession: { isCurrent: true } }, select: { section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } } },
          parents: { where: { isPrimary: true }, take: 1, select: { parent: { select: { firstName: true, lastName: true, phone: true } } } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    studentId: row.student.id,
    name: fullName(row.student),
    admissionNumber: row.student.admissionNumber,
    section: row.student.enrollments[0] ? sectionLabel(row.student.enrollments[0].section) : null,
    stop: row.stop?.name ?? null,
    pickup: row.stop?.pickupMinute ?? null,
    guardian: row.student.parents[0]?.parent ?? null,
    status: row.status,
  }));
}

/** What a parent sees about one of their children — the caller has already checked the link. */
export async function childTransport(ctx: TenantContext, studentId: string) {
  const row = await ctx.db.studentTransport.findFirst({
    where: { studentId, status: "ACTIVE" },
    select: {
      route: {
        select: {
          name: true,
          vehicle: { select: { registrationNo: true } },
          driver: { select: { firstName: true, lastName: true, phone: true } },
          attendant: { select: { firstName: true, lastName: true, phone: true } },
        },
      },
      stop: { select: { name: true, pickupMinute: true, dropMinute: true } },
    },
  });
  if (!row) return null;
  return {
    route: row.route.name,
    vehicle: row.route.vehicle?.registrationNo ?? null,
    driver: row.route.driver ? { name: fullName(row.route.driver), phone: row.route.driver.phone } : null,
    attendant: row.route.attendant ? { name: fullName(row.route.attendant), phone: row.route.attendant.phone } : null,
    stop: row.stop?.name ?? null,
    pickup: row.stop?.pickupMinute !== null && row.stop?.pickupMinute !== undefined ? formatMinutes(row.stop.pickupMinute) : null,
    drop: row.stop?.dropMinute !== null && row.stop?.dropMinute !== undefined ? formatMinutes(row.stop.dropMinute) : null,
  };
}

export type ImportError = { line: number; message: string };

/** Assign students to routes from CSV: Admission no., Route, Stop. All rows checked first. */
export async function importTransport(ctx: TenantContext, text: string): Promise<{ assigned: number; errors: ImportError[] }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  let records;
  try {
    records = readCsvRecords(text, { required: ["Admission no.", "Route"], maxRows: 1000 });
  } catch (error) {
    if (error instanceof CsvFormatError) return { assigned: 0, errors: [{ line: 1, message: error.message }] };
    throw error;
  }
  const [students, routes] = await Promise.all([
    ctx.db.student.findMany({ where: { status: "ACTIVE" }, select: { id: true, admissionNumber: true } }),
    ctx.db.transportRoute.findMany({
      where: { isActive: true },
      select: { id: true, name: true, vehicle: { select: { capacity: true } }, stops: { select: { id: true, name: true } } },
    }),
  ]);
  const studentBy = new Map(students.map((row) => [row.admissionNumber.toLowerCase(), row.id]));
  const routeBy = new Map(routes.map((row) => [row.name.toLowerCase(), row]));
  const errors: ImportError[] = [];
  const rows: Array<{ studentId: string; routeId: string; stopId: string | null }> = [];
  const seen = new Set<string>();

  for (const record of records) {
    const v = record.values;
    const studentId = studentBy.get((v["admission no"] ?? "").toLowerCase());
    const route = routeBy.get((v["route"] ?? "").toLowerCase());
    const problems: string[] = [];
    if (!studentId) problems.push(`no active student with admission no. "${v["admission no"]}"`);
    else if (seen.has(studentId)) problems.push("student appears twice");
    if (!route) problems.push(`no active route "${v["route"]}"`);
    const stopName = v["stop"] ?? "";
    const stop = route && stopName ? route.stops.find((row) => row.name.toLowerCase() === stopName.toLowerCase()) : undefined;
    if (route && stopName && !stop) problems.push(`no stop "${stopName}" on ${route.name}`);
    if (problems.length) {
      errors.push({ line: record.line, message: problems.join("; ") });
      continue;
    }
    seen.add(studentId!);
    rows.push({ studentId: studentId!, routeId: route!.id, stopId: stop?.id ?? null });
  }

  for (const route of routes) {
    if (!route.vehicle) continue;
    const adding = rows.filter((row) => row.routeId === route.id).map((row) => row.studentId);
    if (!adding.length) continue;
    const riding = await ctx.db.studentTransport.count({ where: { routeId: route.id, status: "ACTIVE", studentId: { notIn: adding } } });
    if (riding + adding.length > route.vehicle.capacity) {
      errors.push({ line: 1, message: `${route.name} seats ${route.vehicle.capacity}; ${riding} already ride and the file adds ${adding.length}.` });
    }
  }
  if (errors.length) return { assigned: 0, errors: errors.sort((a, b) => a.line - b.line) };
  if (!rows.length) return { assigned: 0, errors: [{ line: 1, message: "The file has no rows." }] };

  const start = today();
  await ctx.db.$transaction(
    rows.map((row) =>
      ctx.db.studentTransport.upsert({
        where: { schoolId_studentId: { schoolId: ctx.schoolId, studentId: row.studentId } },
        create: { schoolId: ctx.schoolId, studentId: row.studentId, routeId: row.routeId, stopId: row.stopId, startDate: start },
        update: { routeId: row.routeId, stopId: row.stopId, status: "ACTIVE" },
      }),
    ),
  );
  await audit(ctx, "TRANSPORT_ASSIGNED", `${rows.length} transport assignments imported from CSV.`);
  return { assigned: rows.length, errors: [] };
}

/** Students per route and seats used — for the report and CSV. */
export async function transportTable(ctx: TenantContext): Promise<ReportTable> {
  const routes = await listRoutes(ctx);
  return {
    head: ["Route", "Vehicle", "Seats", "Students", "Seats used %", "Driver", "Driver phone", "Attendant", "Stops"],
    rows: routes.map((route) => [
      route.name,
      route.vehicle?.registrationNo ?? "",
      route.vehicle?.capacity ?? "",
      route.riders,
      route.utilisation === null ? "" : Math.round(route.utilisation * 100),
      route.driver ? fullName(route.driver) : "",
      route.driver?.phone ?? "",
      route.attendant ? fullName(route.attendant) : "",
      route.stops.map((stop) => stop.name).join(" → "),
    ]),
  };
}

