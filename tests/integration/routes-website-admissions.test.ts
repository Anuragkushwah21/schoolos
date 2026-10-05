/**
 * Driver routes, the Website's admission form, and admissions by source.
 *
 *   * A route has a number, start and end points, optional stops with a
 *     landmark, which the admin can edit; its assigned driver sees all of it
 *     (and gets a "My route" link) without any transport grant — and nothing
 *     of students, fees or library.
 *   * The admission form can be unpublished: the public page and the server
 *     both stop taking applications until it is published again.
 *   * Online applications and older office-entered ones are listed apart.
 *   * Another school can touch none of it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { staffNav } from "@/lib/nav";
import { admissionApplicationSchema } from "@/lib/validation/website";
import type { TenantContext } from "@/server/auth/current-user";
import { staffGrants } from "@/server/auth/staff-access";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import { __resetAllRateLimits } from "@/server/auth/rate-limit";
import { prisma } from "@/server/db/prisma";
import { publicPortal, setPortalPublished } from "@/server/admissions/portal";
import { applicationCounts, listApplications, submitApplication } from "@/server/admissions/service";
import { listBooks } from "@/server/operations/library";
import { addStop, listRoutes, saveRoute } from "@/server/operations/transport";
import { feeDeskToday, staffStudentDirectory } from "@/server/staff/portal";
import { hasAssignedRoute, myAssignedRoutes } from "@/server/transport/driver";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let slugA: string;
let driver: { id: string; ctx: TenantContext };
let routeId: string;

async function addStaff(school: SeededSchool, key: string, role: "DRIVER" | "TRANSPORT_ATTENDANT") {
  const user = await prisma.user.create({ data: { email: `${key}@rwa-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Singh", schoolId: school.schoolId } });
  const staff = await prisma.staffMember.create({ data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Singh", role, phone: "+91 9876500000", grants: STAFF_ROLE_DEFAULT_GRANTS[role] } });
  return { id: staff.id, ctx: contextFor(school, user.id, "NON_TEACHING_STAFF") };
}

const application = (overrides: Record<string, string> = {}) =>
  admissionApplicationSchema.parse({ studentFirstName: "Meera", studentLastName: "Joshi", requestedClassId: schoolA.classId, parentName: "Anil Joshi", parentPhone: "9822233344", ...overrides });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  slugA = (await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).slug;
  driver = await addStaff(schoolA, "rwadriver", "DRIVER");
}, 60_000);

beforeEach(() => __resetAllRateLimits());

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("driver routes", () => {
  it("creates a route with number and start/end, no stops needed, and the driver sees it", async () => {
    const attendant = await addStaff(schoolA, "rwaattendant", "TRANSPORT_ATTENDANT");
    routeId = await saveRoute(adminOf(schoolA), {
      routeId: null,
      name: "Vijay Nagar",
      code: "R-3",
      startPoint: "Vijay Nagar depot",
      endPoint: "School main gate",
      vehicleId: null,
      driverId: driver.id,
      attendantId: attendant.id,
      isActive: true,
      notes: "Wait two minutes at each stop.",
    });
    expect(await hasAssignedRoute(driver.ctx)).toBe(true);
    const [route] = await myAssignedRoutes(driver.ctx);
    expect(route).toMatchObject({ id: routeId, code: "R-3", startPoint: "Vijay Nagar depot", endPoint: "School main gate", as: "DRIVER", stops: [], notes: "Wait two minutes at each stop." });
    expect(route!.crew).toMatchObject([{ role: "Attendant", name: "rwaattendant Singh" }]);
    // The attendant sees the same route, with the driver as crew.
    expect((await myAssignedRoutes(attendant.ctx))[0]).toMatchObject({ id: routeId, as: "ATTENDANT", crew: [{ role: "Driver" }] });
  });

  it("adds stops with a landmark and order, edits one, and the driver sees them in order", async () => {
    await addStop(adminOf(schoolA), { routeId, stopId: null, name: "Post office", location: "Sector 4 market", sequence: 2, pickupMinute: 7 * 60 + 20, dropMinute: null });
    await addStop(adminOf(schoolA), { routeId, stopId: null, name: "Temple", location: null, sequence: 1, pickupMinute: 7 * 60 + 5, dropMinute: null });
    const temple = await prisma.routeStop.findFirstOrThrow({ where: { routeId, name: "Temple" } });
    await addStop(adminOf(schoolA), { routeId, stopId: temple.id, name: "Shiv temple", location: "Opposite the park", sequence: 1, pickupMinute: 7 * 60, dropMinute: 14 * 60 });

    const [route] = await myAssignedRoutes(driver.ctx);
    expect(route!.stops.map((stop) => [stop.name, stop.location])).toEqual([
      ["Shiv temple", "Opposite the park"],
      ["Post office", "Sector 4 market"],
    ]);
    expect((await listRoutes(adminOf(schoolA))).find((row) => row.id === routeId)).toMatchObject({ code: "R-3", startPoint: "Vijay Nagar depot" });
  });

  it("gives the driver a My route link and nothing of students, fees or library", async () => {
    const permissions = await staffGrants(driver.ctx);
    expect(permissions).toEqual(STAFF_ROLE_DEFAULT_GRANTS.DRIVER);
    const nav = staffNav(permissions, { assignedRoute: await hasAssignedRoute(driver.ctx) }).map((item) => item.href);
    expect(nav).toContain("/staff/my-route");
    for (const href of ["/staff/students", "/staff/fees", "/staff/library", "/staff/transport"]) expect(nav).not.toContain(href);
    await expect(staffStudentDirectory(driver.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(feeDeskToday(driver.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listBooks(driver.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRoutes(driver.ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only this school's admin edits its routes and stops", async () => {
    const stop = await prisma.routeStop.findFirstOrThrow({ where: { routeId } });
    await expect(addStop(adminOf(schoolB), { routeId, stopId: stop.id, name: "Hijack", location: null, sequence: 9, pickupMinute: null, dropMinute: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(addStop(teacherOf(schoolA), { routeId, stopId: null, name: "x", location: null, sequence: 9, pickupMinute: null, dropMinute: null })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await myAssignedRoutes(await addStaff(schoolB, "rwadriverb", "DRIVER").then((row) => row.ctx))).toEqual([]);
  });
});

describe("website admission form", () => {
  it("unpublishing stops the public form and the server; publishing opens it again", async () => {
    expect((await publicPortal(schoolA.schoolId)).window.state).toBe("OPEN");
    await setPortalPublished(adminOf(schoolA), false);
    expect((await publicPortal(schoolA.schoolId)).window.state).toBe("UNPUBLISHED");
    await expect(submitApplication(slugA, application(), { ipAddress: "9.9.9.1" })).rejects.toBeInstanceOf(AppError);
    // School B's form is untouched.
    expect((await publicPortal(schoolB.schoolId)).window.state).toBe("OPEN");

    await setPortalPublished(adminOf(schoolA), true);
    const { applicationNumber } = await submitApplication(slugA, application(), { ipAddress: "9.9.9.2" });
    expect(applicationNumber).toMatch(/^APP-/);
  });

  it("only the School Admin can publish or unpublish", async () => {
    await expect(setPortalPublished(teacherOf(schoolA), false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPortalPublished(driver.ctx, false)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("admissions by source", () => {
  it("lists online applications apart from older office-entered ones", async () => {
    const online = await prisma.admissionApplication.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, studentFirstName: "Meera" } });
    // An application the office typed in before walk-ins became enquiries.
    const office = await prisma.admissionApplication.create({
      data: {
        schoolId: online.schoolId,
        academicSessionId: online.academicSessionId,
        requestedClassId: online.requestedClassId,
        applicationNumber: "APP-OLD-00001",
        source: "WALK_IN",
        studentFirstName: "Old",
        studentLastName: "Entry",
        parentName: "Office Parent",
        parentPhone: "+91 9811100000",
      },
    });

    const onlineIds = (await listApplications(adminOf(schoolA), { origin: "online" })).map((row) => row.id);
    const officeIds = (await listApplications(adminOf(schoolA), { origin: "office" })).map((row) => row.id);
    expect(onlineIds).toContain(online.id);
    expect(onlineIds).not.toContain(office.id);
    expect(officeIds).toEqual([office.id]);

    const counts = await applicationCounts(adminOf(schoolA));
    expect(counts.counts.SUBMITTED).toBeGreaterThanOrEqual(1);
    expect(counts.office).toBe(1);
    expect((await applicationCounts(adminOf(schoolB))).office).toBe(0);
    expect((await listApplications(adminOf(schoolB), { origin: "online" })).map((row) => row.id)).not.toContain(online.id);
  });
});
