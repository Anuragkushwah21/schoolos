/**
 * From a driver's or attendant's profile the School Admin puts them on a
 * route, moves them to another in one step, or takes them off — only people
 * with the right role, only this school's routes, nothing else on the route
 * touched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { assignRouteCrew, moveRouteCrew, removeRouteCrew } from "@/server/operations/transport";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let driver: string;
let otherDriver: string;
let attendant: string;
let librarian: string;
let routeA: string;
let routeB: string;
let foreignRoute: string;

const staff = (school: SeededSchool, key: string, role: "DRIVER" | "TRANSPORT_ATTENDANT" | "LIBRARIAN") =>
  prisma.staffMember.create({ data: { schoolId: school.schoolId, employeeId: key, firstName: key, lastName: "Crew", role } }).then((row) => row.id);
const route = (id: string) => prisma.transportRoute.findUniqueOrThrow({ where: { id }, select: { driverId: true, attendantId: true } });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  driver = await staff(schoolA, "RC-D1", "DRIVER");
  otherDriver = await staff(schoolA, "RC-D2", "DRIVER");
  attendant = await staff(schoolA, "RC-A1", "TRANSPORT_ATTENDANT");
  librarian = await staff(schoolA, "RC-L1", "LIBRARIAN");
  routeA = (await prisma.transportRoute.create({ data: { schoolId: schoolA.schoolId, name: "RC Route A" } })).id;
  routeB = (await prisma.transportRoute.create({ data: { schoolId: schoolA.schoolId, name: "RC Route B", driverId: otherDriver } })).id;
  await prisma.routeStop.create({ data: { schoolId: schoolA.schoolId, routeId: routeB, name: "Gate", sequence: 1 } });
  foreignRoute = (await prisma.transportRoute.create({ data: { schoolId: schoolB.schoolId, name: "RC Foreign" } })).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("route crew from the profile", () => {
  it("puts a driver and an attendant on a route", async () => {
    expect(await assignRouteCrew(adminOf(schoolA), { routeId: routeA, staffId: driver, as: "DRIVER" })).toEqual({ replaced: null });
    await assignRouteCrew(adminOf(schoolA), { routeId: routeA, staffId: attendant, as: "ATTENDANT" });
    expect(await route(routeA)).toEqual({ driverId: driver, attendantId: attendant });
  });

  it("moves a driver to another route in one step, replacing whoever drove it, stops untouched", async () => {
    const { replaced } = await moveRouteCrew(adminOf(schoolA), { staffId: driver, fromRouteId: routeA, toRouteId: routeB });
    expect(replaced).toBe("RC-D2 Crew");
    expect(await route(routeA)).toEqual({ driverId: null, attendantId: attendant });
    expect((await route(routeB)).driverId).toBe(driver);
    expect(await prisma.routeStop.count({ where: { routeId: routeB } })).toBe(1);
  });

  it("takes someone off a route", async () => {
    await removeRouteCrew(adminOf(schoolA), { routeId: routeA, staffId: attendant });
    expect((await route(routeA)).attendantId).toBeNull();
    await expect(removeRouteCrew(adminOf(schoolA), { routeId: routeA, staffId: attendant })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses the wrong role, another school's route, and anyone but the School Admin", async () => {
    await expect(assignRouteCrew(adminOf(schoolA), { routeId: routeA, staffId: librarian, as: "DRIVER" })).rejects.toBeInstanceOf(AppError);
    await expect(assignRouteCrew(adminOf(schoolA), { routeId: routeA, staffId: attendant, as: "DRIVER" })).rejects.toBeInstanceOf(AppError);
    await expect(assignRouteCrew(adminOf(schoolA), { routeId: foreignRoute, staffId: driver, as: "DRIVER" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(moveRouteCrew(adminOf(schoolA), { staffId: driver, fromRouteId: routeB, toRouteId: foreignRoute })).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignRouteCrew(adminOf(schoolB), { routeId: routeA, staffId: driver, as: "DRIVER" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignRouteCrew(teacherOf(schoolA), { routeId: routeA, staffId: driver, as: "DRIVER" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await route(routeB)).driverId).toBe(driver);
  });
});
