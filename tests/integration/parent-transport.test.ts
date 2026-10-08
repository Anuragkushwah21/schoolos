/**
 * Parent-facing transport status, from the trip marks drivers already make.
 *
 *   * A parent sees their own child's route, stop, and today's pickup and
 *     drop — Pending until marked, then the status with the time.
 *   * Never another family's child, and never another rider's name or mark.
 *   * A driver marks only riders on their own route; the School Admin may mark
 *     or correct any route's trip. Every mark is audited.
 *   * While a substitute covers the driver, the parent sees the substitute.
 *   * Another school's parent reaches nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { markTrip } from "@/server/transport/driver";
import { childTransportToday } from "@/server/transport/parent-status";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
type Staff = { id: string; ctx: TenantContext };
let driver1: Staff;
let driver2: Staff;
let spare: Staff;
let route1: string;
let parentA: TenantContext;
let otherParent: TenantContext;
let child: string;
let otherRider: string;
let otherRiderName: string;

async function addDriver(key: string): Promise<Staff> {
  const user = await prisma.user.create({ data: { email: `${key}@ptr-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Yadav", schoolId: schoolA.schoolId } });
  const staff = await prisma.staffMember.create({
    data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Yadav", role: "DRIVER", grants: ["transport.myroute", "transport.riders", "transport.trips"], phone: "+91 97777 66666" },
  });
  return { id: staff.id, ctx: contextFor(schoolA, user.id, "NON_TEACHING_STAFF") };
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const schoolId = schoolA.schoolId;
  driver1 = await addDriver("ptr-d1");
  driver2 = await addDriver("ptr-d2");
  spare = await addDriver("ptr-sub");
  route1 = (await prisma.transportRoute.create({ data: { schoolId, name: "Route 01", code: "01", driverId: driver1.id } })).id;
  await prisma.transportRoute.create({ data: { schoolId, name: "Route 02", code: "02", driverId: driver2.id } });
  const stop = await prisma.routeStop.create({ data: { schoolId, routeId: route1, name: "Main Road", sequence: 1, pickupMinute: 7 * 60 + 30, dropMinute: 14 * 60 + 15 } });
  [child, otherRider] = schoolA.studentIds as [string, string];
  otherRiderName = (await prisma.student.findUniqueOrThrow({ where: { id: otherRider } })).firstName;
  for (const studentId of [child, otherRider]) {
    await prisma.studentTransport.create({ data: { schoolId, studentId, routeId: route1, stopId: stop.id, startDate: addDays(today(), -30) } });
  }
  // The fixture parent is linked to every school A student; a second family has only the other rider.
  parentA = contextFor(schoolA, schoolA.parentUserId, "PARENT");
  const user = await prisma.user.create({ data: { email: "other@ptr-test.test", passwordHash: "x", role: "PARENT", firstName: "O", lastName: "P", schoolId } });
  const parent = await prisma.parent.create({ data: { schoolId, userId: user.id, firstName: "O", lastName: "P", phone: "+91 96666 55555" } });
  await prisma.parentStudent.create({ data: { schoolId, parentId: parent.id, studentId: schoolA.studentIds[2]!, relationship: "GUARDIAN", isPrimary: true } });
  otherParent = contextFor(schoolA, user.id, "PARENT");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("what a parent sees", () => {
  it("route, stop and pending trips before anything is marked", async () => {
    const status = await childTransportToday(parentA, child);
    expect(status).toMatchObject({
      route: "Route 01",
      stop: "Main Road",
      scheduled: { pickup: expect.stringMatching(/7:30/), drop: expect.any(String) },
      pickup: { state: "PENDING", at: null },
      drop: { state: "PENDING", at: null },
      driver: { substitute: false },
    });
  });

  it("the pickup with its time once the driver marks it; nothing about other riders", async () => {
    await markTrip(driver1.ctx, { routeId: route1, studentId: child, trip: "PICKUP", status: "PICKED_UP" });
    await markTrip(driver1.ctx, { routeId: route1, studentId: otherRider, trip: "PICKUP", status: "NOT_PRESENT" });
    const status = await childTransportToday(parentA, child);
    expect(status?.pickup).toMatchObject({ state: "PICKED_UP", at: expect.any(Date) });
    expect(status?.drop.state).toBe("PENDING");
    expect(JSON.stringify(status)).not.toContain(otherRiderName);
    expect(JSON.stringify(status)).not.toContain("NOT_PRESENT");
  });

  it("never another family's child, or another school's", async () => {
    await expect(childTransportToday(otherParent, child)).rejects.toBeInstanceOf(NotFoundError);
    await expect(childTransportToday(contextFor(schoolB, schoolB.parentUserId, "PARENT"), child)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a child without school transport has none", async () => {
    expect(await childTransportToday(otherParent, schoolA.studentIds[2]!)).toBeNull();
  });
});

describe("who may mark", () => {
  it("a driver only their own route's riders; the School Admin any, and it is audited", async () => {
    await expect(markTrip(driver2.ctx, { routeId: route1, studentId: child, trip: "DROP", status: "DROPPED" })).rejects.toBeInstanceOf(ForbiddenError);
    await markTrip(adminOf(schoolA), { routeId: route1, studentId: child, trip: "DROP", status: "DROPPED" });
    expect((await childTransportToday(parentA, child))?.drop.state).toBe("DROPPED");
    const audit = await prisma.auditLog.findMany({ where: { schoolId: schoolA.schoolId, action: "TRANSPORT_TRIP_MARKED" }, select: { summary: true } });
    expect(audit.length).toBeGreaterThanOrEqual(3);
    // A correction says what it was before.
    await markTrip(adminOf(schoolA), { routeId: route1, studentId: child, trip: "DROP", status: "NOT_PRESENT" });
    expect((await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "TRANSPORT_TRIP_MARKED" }, orderBy: { createdAt: "desc" } }))?.summary).toMatch(/was dropped/);
  });

  it("the parent sees the substitute driver while one covers", async () => {
    await prisma.staffSubstitution.create({
      data: { schoolId: schoolA.schoolId, originalStaffId: driver1.id, substituteStaffId: spare.id, startDate: today(), endDate: addDays(today(), 2), reason: "Leave", coverRoutes: true },
    });
    expect((await childTransportToday(parentA, child))?.driver).toMatchObject({ name: "ptr-sub Yadav", substitute: true });
    // And the substitute may mark the route's riders today.
    await markTrip(spare.ctx, { routeId: route1, studentId: child, trip: "DROP", status: "DROPPED" });
  });
});
