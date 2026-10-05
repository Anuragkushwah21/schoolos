/**
 * Non-teaching staff: role profiles, module × action grants, route-scoped
 * driver data, and date-range substitutions with temporary access.
 *
 *   * Roles: built-ins are created per school with default grants; a custom
 *     role can be added; new staff start with their role's defaults; a role
 *     change can be pushed to everyone in it. A role never holds what its
 *     designation excludes (a librarian: finance).
 *   * Permission on → module and API open; off → closed, on the server.
 *   * Driver scope: Route 01's driver sees and marks only Route 01's students;
 *     Route 02's driver cannot; contacts only with that permission.
 *   * Substitute: before the start date nothing; during it the substitute has
 *     the temporary grants and the original's route; after the end date (or
 *     ended early) nothing — all from the dates, the record kept.
 *   * Archived staff hold nothing, and their history stays.
 *   * School B never reaches School A's data, in services or over the API.
 */
import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import { staffSchema } from "@/lib/validation/operations";
import type { TenantContext } from "@/server/auth/current-user";
import { staffGrants } from "@/server/auth/staff-access";
import { prisma } from "@/server/db/prisma";
import { listExpenses } from "@/server/finance/expenses";
import { listFeePositions } from "@/server/finance/fees";
import { saveStaff, setStaffGrants, staffAccessHistory } from "@/server/operations/staff";
import { changeEmployeeStatus } from "@/server/people/lifecycle";
import { listRoleProfiles, saveRoleProfile } from "@/server/staff/roles";
import { endSubstitution, listSubstitutions, saveSubstitution, substitutionStatus, substitutionsFor } from "@/server/staff/substitutions";
import { hasAssignedRoute, markTrip, myAssignedRoutes, myRouteRiders, reportRouteIssue, routeActivity } from "@/server/transport/driver";
import * as myRouteApi from "@/app/api/v1/transport/my-route/route";
import * as ridersApi from "@/app/api/v1/transport/my-route/[routeId]/students/route";
import * as tripsApi from "@/app/api/v1/transport/trips/route";
import * as permissionsApi from "@/app/api/v1/staff/[staffId]/permissions/route";

import { apiRequest, callApi } from "../helpers/api";
import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
type Person = { id: string; userId: string; ctx: TenantContext };
let driver1: Person;
let driver2: Person;
let accountant: Person;
let librarian: Person;
let driverB: Person;
let route1: string;
let route2: string;
let routeB: string;
let stopA: string;
let stopB: string;

async function addStaff(school: SeededSchool, key: string, role: "DRIVER" | "ACCOUNTANT" | "LIBRARIAN" | "OTHER", grants: string[] = STAFF_ROLE_DEFAULT_GRANTS[role]): Promise<Person> {
  const user = await prisma.user.create({ data: { email: `${key}@srs-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Kumar", schoolId: school.schoolId } });
  const staff = await prisma.staffMember.create({ data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Kumar", role, grants } });
  return { id: staff.id, userId: user.id, ctx: contextFor(school, user.id, "NON_TEACHING_STAFF") };
}

async function addRoute(school: SeededSchool, name: string, driverId: string) {
  return (await prisma.transportRoute.create({ data: { schoolId: school.schoolId, name, driverId, code: name.slice(-2) } })).id;
}

async function ride(school: SeededSchool, studentId: string, routeId: string, stopId: string | null) {
  await prisma.studentTransport.upsert({
    where: { schoolId_studentId: { schoolId: school.schoolId, studentId } },
    create: { schoolId: school.schoolId, studentId, routeId, stopId, startDate: today() },
    update: { routeId, stopId, status: "ACTIVE" },
  });
}

async function tokenFor(userId: string, schoolId: string, scope: "READ" | "FULL" = "FULL") {
  const raw = `sos_${randomBytes(32).toString("base64url")}`;
  await prisma.apiToken.create({ data: { name: "staff test", tokenHash: createHash("sha256").update(raw).digest("hex"), prefix: raw.slice(0, 8), scope, userId, schoolId } });
  return raw;
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  driver1 = await addStaff(schoolA, "srsdriver1", "DRIVER");
  driver2 = await addStaff(schoolA, "srsdriver2", "DRIVER");
  accountant = await addStaff(schoolA, "srsaccountant", "ACCOUNTANT");
  librarian = await addStaff(schoolA, "srslibrarian", "LIBRARIAN");
  driverB = await addStaff(schoolB, "srsdriverb", "DRIVER");
  route1 = await addRoute(schoolA, "Route 01", driver1.id);
  route2 = await addRoute(schoolA, "Route 02", driver2.id);
  routeB = await addRoute(schoolB, "Route B1", driverB.id);
  stopA = (await prisma.routeStop.create({ data: { schoolId: schoolA.schoolId, routeId: route1, name: "Stop A", sequence: 1, pickupMinute: 7 * 60 + 10 } })).id;
  stopB = (await prisma.routeStop.create({ data: { schoolId: schoolA.schoolId, routeId: route1, name: "Stop B", sequence: 2, pickupMinute: 7 * 60 + 20 } })).id;
  // Route 01: two students at Stop A, one at Stop B. Route 02: one student.
  await ride(schoolA, schoolA.studentIds[0]!, route1, stopA);
  await ride(schoolA, schoolA.studentIds[1]!, route1, stopA);
  await ride(schoolA, schoolA.studentIds[2]!, route1, stopB);
  await ride(schoolB, schoolB.studentIds[0]!, routeB, null);
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("roles", () => {
  it("creates the built-in roles per school with defaults, and a custom one", async () => {
    const roles = await listRoleProfiles(adminOf(schoolA));
    const librarianRole = roles.find((role) => role.baseRole === "LIBRARIAN" && !role.isCustom)!;
    expect(librarianRole.name).toBe("Librarian");
    expect(librarianRole.defaultGrants).toEqual(STAFF_ROLE_DEFAULT_GRANTS.LIBRARIAN);
    expect(roles.find((role) => role.name === "Support staff")?.baseRole).toBe("PEON");
    // Existing staff are linked to their built-in role.
    expect(librarianRole.staffCount).toBe(1);

    const { id } = await saveRoleProfile(adminOf(schoolA), { name: "Hostel warden", baseRole: "OTHER", description: "Night duty", defaultGrants: ["students.directory"] });
    expect((await listRoleProfiles(adminOf(schoolB))).some((role) => role.id === id)).toBe(false);

    // A new staff member in it starts with its defaults.
    const staffId = await saveStaff(adminOf(schoolA), staffSchema.parse({ employeeId: "WARD1", firstName: "Gopal", lastName: "Das", roleProfileId: id }));
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: staffId } })).grants).toEqual(["students.directory"]);

    // Pushing a change to everyone in the role.
    await saveRoleProfile(adminOf(schoolA), { roleId: id, name: "Hostel warden", baseRole: "OTHER", description: null, defaultGrants: ["inventory.view"], applyToStaff: true });
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: staffId } })).grants).toEqual(["inventory.view"]);
  });

  it("never lets a librarian role or person hold finance", async () => {
    const librarianRole = (await listRoleProfiles(adminOf(schoolA))).find((role) => role.baseRole === "LIBRARIAN")!;
    await expect(saveRoleProfile(adminOf(schoolA), { roleId: librarianRole.id, name: "Librarian", baseRole: "LIBRARIAN", description: null, defaultGrants: ["library.view", "fees.collect"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(setStaffGrants(adminOf(schoolA), librarian.id, ["library.view", "payroll.view"])).rejects.toBeInstanceOf(ValidationError);
    await expect(saveRoleProfile(teacherOf(schoolA), { name: "X", baseRole: "OTHER", description: null, defaultGrants: [] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("permissions on and off", () => {
  it("opens a module only while the grant is on — services and API alike", async () => {
    await expect(listExpenses(accountant.ctx, {})).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), accountant.id, [...STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT, "expenses.view"]);
    await expect(listExpenses(accountant.ctx, {})).resolves.toBeDefined();
    await setStaffGrants(adminOf(schoolA), accountant.id, ["expenses.view"]);
    await expect(listFeePositions(accountant.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), accountant.id, STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
    await expect(listExpenses(accountant.ctx, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await staffAccessHistory(adminOf(schoolA), accountant.id)).length).toBeGreaterThanOrEqual(3);

    // The permissions API: admin only, own school only.
    const adminToken = await tokenFor(schoolA.adminUserId, schoolA.schoolId);
    const ok = await callApi(permissionsApi.PUT, apiRequest(`/api/v1/staff/${accountant.id}/permissions`, { method: "PUT", token: adminToken, body: { grants: ["fees.view"] } }), { staffId: accountant.id });
    expect(ok.status).toBe(200);
    expect((ok.body.data as { grants: string[] }).grants).toEqual(["fees.view"]);
    const bToken = await tokenFor(schoolB.adminUserId, schoolB.schoolId);
    const cross = await callApi(permissionsApi.GET, apiRequest(`/api/v1/staff/${accountant.id}/permissions`, { token: bToken }), { staffId: accountant.id });
    expect(cross.status).toBe(404);
    const staffToken = await tokenFor(accountant.userId, schoolA.schoolId);
    expect((await callApi(permissionsApi.GET, apiRequest(`/api/v1/staff/${accountant.id}/permissions`, { token: staffToken }), { staffId: accountant.id })).status).toBe(403);
    await setStaffGrants(adminOf(schoolA), accountant.id, STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
  });
});

describe("driver scope", () => {
  it("shows Route 01's driver its stops with counts, and only its students", async () => {
    const [route] = await myAssignedRoutes(driver1.ctx);
    expect(route).toMatchObject({ id: route1, as: "DRIVER", riders: 3 });
    expect(route!.stops.map((stop) => [stop.name, stop.riders])).toEqual([
      ["Stop A", 2],
      ["Stop B", 1],
    ]);
    const all = await myRouteRiders(driver1.ctx, route1);
    expect(all.riders.map((row) => row.studentId).sort()).toEqual(schoolA.studentIds.slice(0, 3).sort());
    expect(all.riders.every((row) => row.guardian === null)).toBe(true);
    const atA = await myRouteRiders(driver1.ctx, route1, { stopId: stopA });
    expect(atA.riders.map((row) => row.studentId).sort()).toEqual(schoolA.studentIds.slice(0, 2).sort());
    expect(atA.riders[0]).toMatchObject({ className: expect.any(String), section: expect.any(String), stop: { name: "Stop A" } });
  });

  it("refuses Route 02's driver anything of Route 01", async () => {
    await expect(myRouteRiders(driver2.ctx, route1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markTrip(driver2.ctx, { routeId: route1, studentId: schoolA.studentIds[0]!, trip: "PICKUP", status: "PICKED_UP" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await myAssignedRoutes(driver2.ctx)).map((row) => row.id)).toEqual([route2]);
  });

  it("marks pickup and drop for its own students only, and shows contacts only with that permission", async () => {
    await markTrip(driver1.ctx, { routeId: route1, studentId: schoolA.studentIds[0]!, trip: "PICKUP", status: "PICKED_UP" });
    await markTrip(driver1.ctx, { routeId: route1, studentId: schoolA.studentIds[1]!, trip: "PICKUP", status: "NOT_PRESENT" });
    await markTrip(driver1.ctx, { routeId: route1, studentId: schoolA.studentIds[0]!, trip: "DROP", status: "DROPPED" });
    await expect(markTrip(driver1.ctx, { routeId: route1, studentId: schoolA.studentIds[2]!, trip: "PICKUP", status: "ISSUE" })).rejects.toThrow(/issue/i);
    await markTrip(driver1.ctx, { routeId: route1, studentId: schoolA.studentIds[2]!, trip: "PICKUP", status: "ISSUE", note: "Missed the bus" });
    // A student who does not ride this route.
    await expect(markTrip(driver1.ctx, { routeId: route1, studentId: schoolA.studentIds[3] ?? schoolB.studentIds[0]!, trip: "PICKUP", status: "PICKED_UP" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(markTrip(driver1.ctx, { routeId: route1, studentId: schoolA.studentIds[0]!, trip: "DROP", status: "PICKED_UP" })).rejects.toThrow(/does not apply/);

    const riders = await myRouteRiders(driver1.ctx, route1);
    expect(riders.riders.find((row) => row.studentId === schoolA.studentIds[0])).toMatchObject({ pickup: { status: "PICKED_UP" }, drop: { status: "DROPPED" } });

    await setStaffGrants(adminOf(schoolA), driver1.id, [...STAFF_ROLE_DEFAULT_GRANTS.DRIVER, "transport.contacts"]);
    expect((await myRouteRiders(driver1.ctx, route1)).riders.some((row) => row.guardian?.phone)).toBe(true);
    await setStaffGrants(adminOf(schoolA), driver1.id, ["transport.myroute"]);
    await expect(myRouteRiders(driver1.ctx, route1)).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), driver1.id, STAFF_ROLE_DEFAULT_GRANTS.DRIVER);

    await reportRouteIssue(driver1.ctx, { routeId: route1, note: "Tyre puncture near Stop B" });
    const activity = await routeActivity(adminOf(schoolA), route1);
    expect(activity.today.length).toBe(4);
    expect(activity.history[0]!.notes.join(" ")).toMatch(/Tyre puncture/);
  });

  it("works over the API with the same scope", async () => {
    const token = await tokenFor(driver1.userId, schoolA.schoolId);
    const routes = await callApi(myRouteApi.GET, apiRequest("/api/v1/transport/my-route", { token }));
    expect((routes.body.data as Array<{ id: string }>).map((row) => row.id)).toEqual([route1]);
    const theirs = await callApi(ridersApi.GET, apiRequest(`/api/v1/transport/my-route/${route2}/students`, { token }), { routeId: route2 });
    expect(theirs.status).toBe(403);
    const marked = await callApi(tripsApi.POST, apiRequest("/api/v1/transport/trips", { method: "POST", token, body: { routeId: route1, studentId: schoolA.studentIds[1], trip: "PICKUP", status: "PICKED_UP" } }));
    expect(marked.status).toBe(200);
    const adminToken = await tokenFor(schoolA.adminUserId, schoolA.schoolId);
    expect((await callApi(myRouteApi.GET, apiRequest("/api/v1/transport/my-route", { token: adminToken }))).status).toBe(403);
  });
});

describe("substitutes", () => {
  it("lends access only between the dates, then lets it expire by itself", async () => {
    const tomorrow = addDays(today(), 1);
    const { id } = await saveSubstitution(adminOf(schoolA), {
      originalStaffId: driver1.id,
      substituteStaffId: driver2.id,
      startDate: tomorrow,
      endDate: addDays(today(), 3),
      reason: "Rajesh on leave",
      notes: null,
      grants: STAFF_ROLE_DEFAULT_GRANTS.DRIVER,
      coverRoutes: true,
    });
    // Before the start date: scheduled, nothing lent.
    expect(substitutionStatus((await prisma.staffSubstitution.findUniqueOrThrow({ where: { id } })))).toBe("SCHEDULED");
    await expect(myRouteRiders(driver2.ctx, route1)).rejects.toBeInstanceOf(ForbiddenError);

    // During: Route 01 appears for the substitute, marked as covering.
    await prisma.staffSubstitution.update({ where: { id }, data: { startDate: today() } });
    const routes = await myAssignedRoutes(driver2.ctx);
    expect(routes.find((row) => row.id === route1)).toMatchObject({ as: "SUBSTITUTE", coveringFor: "srsdriver1 Kumar" });
    expect((await myRouteRiders(driver2.ctx, route1)).riders.length).toBe(3);
    await markTrip(driver2.ctx, { routeId: route1, studentId: schoolA.studentIds[2]!, trip: "DROP", status: "DROPPED" });
    // The original keeps their own route and grants.
    expect((await myAssignedRoutes(driver1.ctx)).map((row) => row.id)).toEqual([route1]);
    expect((await prisma.transportRoute.findUniqueOrThrow({ where: { id: route1 } })).driverId).toBe(driver1.id);

    // After the end date: expired, nothing lent, record kept.
    await prisma.staffSubstitution.update({ where: { id }, data: { startDate: addDays(today(), -5), endDate: addDays(today(), -1) } });
    await expect(myRouteRiders(driver2.ctx, route1)).rejects.toBeInstanceOf(ForbiddenError);
    const history = await substitutionsFor(adminOf(schoolA), driver1.id);
    expect(history.coveredBy.map((row) => [row.id, row.status])).toEqual([[id, "EXPIRED"]]);
    expect((await listSubstitutions(adminOf(schoolA), { status: "EXPIRED" })).map((row) => row.id)).toContain(id);
  });

  it("lends temporary grants to a colleague in another role, and ending early stops them at once", async () => {
    const other = await addStaff(schoolA, "srsoffice", "OTHER", []);
    await expect(listFeePositions(other.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    const { id } = await saveSubstitution(adminOf(schoolA), {
      originalStaffId: accountant.id,
      substituteStaffId: other.id,
      startDate: today(),
      endDate: addDays(today(), 2),
      reason: "Accountant on leave",
      notes: "Fee desk only",
      grants: ["fees.view", "fees.collect"],
      coverRoutes: false,
    });
    expect(await staffGrants(other.ctx)).toEqual(["fees.view", "fees.collect"]);
    await expect(listFeePositions(other.ctx)).resolves.toBeDefined();
    // The accountant themselves is unchanged.
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: accountant.id } })).grants).toEqual(STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);

    await endSubstitution(adminOf(schoolA), id);
    expect(await staffGrants(other.ctx)).toEqual([]);
    expect((await substitutionsFor(adminOf(schoolA), other.id)).covering[0]).toMatchObject({ id, status: "ENDED", endedBy: expect.any(String) });
  });

  it("refuses a substitute whose role can never hold the access, and dates that make no sense", async () => {
    await expect(
      saveSubstitution(adminOf(schoolA), { originalStaffId: accountant.id, substituteStaffId: librarian.id, startDate: today(), endDate: today(), reason: "x", notes: null, grants: ["fees.collect"], coverRoutes: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveSubstitution(adminOf(schoolA), { originalStaffId: driver1.id, substituteStaffId: driver2.id, startDate: today(), endDate: addDays(today(), -1), reason: "x", notes: null, grants: [], coverRoutes: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveSubstitution(adminOf(schoolA), { originalStaffId: driver1.id, substituteStaffId: driver1.id, startDate: today(), endDate: today(), reason: "x", notes: null, grants: [], coverRoutes: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Another school's staff cannot be used, either way round.
    await expect(
      saveSubstitution(adminOf(schoolA), { originalStaffId: driver1.id, substituteStaffId: driverB.id, startDate: today(), endDate: today(), reason: "x", notes: null, grants: [], coverRoutes: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveSubstitution(teacherOf(schoolA), { originalStaffId: driver1.id, substituteStaffId: driver2.id, startDate: today(), endDate: today(), reason: "x", notes: null, grants: [], coverRoutes: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect(toDateInput(today())).toMatch(/^\d{4}-/);
  });
});

describe("isolation and history", () => {
  it("never lets School B's driver reach School A's routes or students", async () => {
    expect((await myAssignedRoutes(driverB.ctx)).map((row) => row.id)).toEqual([routeB]);
    await expect(myRouteRiders(driverB.ctx, route1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markTrip(driverB.ctx, { routeId: route1, studentId: schoolA.studentIds[0]!, trip: "PICKUP", status: "PICKED_UP" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(substitutionsFor(adminOf(schoolB), driver1.id)).resolves.toEqual({ coveredBy: [], covering: [] });
    await expect(routeActivity(adminOf(schoolB), route1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an archived driver holds nothing, and their records stay", async () => {
    const before = await prisma.transportTripLog.count({ where: { routeId: route1 } });
    await changeEmployeeStatus(adminOf(schoolA), "STAFF", driver1.id, "RESIGNED", { effectiveDate: today(), reason: "Left", remarks: null, confirmReturn: true });
    expect(await staffGrants(driver1.ctx)).toEqual([]);
    expect(await hasAssignedRoute(driver1.ctx)).toBe(false);
    expect(await prisma.staffMember.count({ where: { id: driver1.id } })).toBe(1);
    expect(await prisma.transportTripLog.count({ where: { routeId: route1 } })).toBe(before);
    expect((await substitutionsFor(adminOf(schoolA), driver1.id)).coveredBy.length).toBe(1);
  });
});
