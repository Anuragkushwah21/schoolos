/**
 * Non-teaching staff: a designation carries only its own work, everything
 * else is an explicit grant, and the School Admin sees all staff attendance.
 *
 *   * A Librarian runs the library and nothing else: no students directory,
 *     transport or fee desk — in the sidebar and in the services behind it.
 *   * An Accountant with "Collect fees" gets the fee desk and its day; the
 *     library and transport stay closed. New accountants are not pre-ticked
 *     for the student directory.
 *   * A Driver sees their own route without any grant, and the school's other
 *     routes only with "View transport". No fees, no library.
 *   * The admin marks every staff member, sees today's overview and one
 *     person's month and leave; staff see only their own register.
 *   * None of it crosses schools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { today } from "@/lib/dates";
import { staffNav } from "@/lib/nav";
import { STAFF_ROLE_DEFAULT_GRANTS, allowedGrants, grantsFrom } from "@/lib/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { staffGrants } from "@/server/auth/staff-access";
import { markStaffAttendance } from "@/server/attendance/service";
import { prisma } from "@/server/db/prisma";
import { listFeePositions } from "@/server/finance/fees";
import { listBooks } from "@/server/operations/library";
import { importStaff, staffOverview, staffRecord } from "@/server/operations/staff";
import { listRoutes } from "@/server/operations/transport";
import { feeDeskToday, myStaffAttendance, staffStudentDirectory } from "@/server/staff/portal";
import { myAssignedRoutes } from "@/server/transport/driver";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

type Role = "LIBRARIAN" | "ACCOUNTANT" | "DRIVER" | "OTHER";
type Permission = "COLLECT_FEES" | "MANAGE_LIBRARY" | "VIEW_LIBRARY" | "VIEW_STUDENTS" | "VIEW_TRANSPORT";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let librarian: { id: string; ctx: TenantContext };
let accountant: { id: string; ctx: TenantContext };
let driver: { id: string; ctx: TenantContext };
let otherDriver: { id: string; ctx: TenantContext };
let transportDesk: { id: string; ctx: TenantContext };
let driverB: { id: string; ctx: TenantContext };
let myRouteId: string;

async function addStaff(school: SeededSchool, key: string, role: Role, permissions: Permission[]) {
  const user = await prisma.user.create({
    data: { email: `${key}@iso-test-a.test`, passwordHash: "not-a-real-hash", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Staff", schoolId: school.schoolId },
  });
  const staff = await prisma.staffMember.create({
    // As the 20261013 migration carried staff over: the old permissions as grants,
    // plus what the role used to bring by itself (the library, their own route).
    data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Staff", role, grants: allowedGrants(role, [...grantsFrom(permissions), ...(role === "LIBRARIAN" || role === "DRIVER" ? STAFF_ROLE_DEFAULT_GRANTS[role] : [])]) },
  });
  return { id: staff.id, ctx: contextFor(school, user.id, "NON_TEACHING_STAFF") };
}

async function addRoute(school: SeededSchool, name: string, driverId: string) {
  const vehicle = await prisma.vehicle.create({ data: { schoolId: school.schoolId, registrationNo: `${name}-REG`, type: "BUS", capacity: 30 } });
  const route = await prisma.transportRoute.create({ data: { schoolId: school.schoolId, name, vehicleId: vehicle.id, driverId } });
  await prisma.routeStop.createMany({
    data: [
      { schoolId: school.schoolId, routeId: route.id, name: `${name} gate`, sequence: 2, pickupMinute: 7 * 60 + 30 },
      { schoolId: school.schoolId, routeId: route.id, name: `${name} market`, sequence: 1, pickupMinute: 7 * 60 + 10 },
    ],
  });
  return route.id;
}

const hrefs = (grants: readonly string[], assignedRoute = false) => staffNav(grants, { assignedRoute }).map((item) => item.href);

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // A librarian with nothing ticked: the designation alone runs the library.
  librarian = await addStaff(schoolA, "nts-librarian", "LIBRARIAN", []);
  accountant = await addStaff(schoolA, "nts-accountant", "ACCOUNTANT", ["COLLECT_FEES"]);
  driver = await addStaff(schoolA, "nts-driver", "DRIVER", []);
  otherDriver = await addStaff(schoolA, "nts-driver-two", "DRIVER", []);
  transportDesk = await addStaff(schoolA, "nts-transport", "DRIVER", ["VIEW_TRANSPORT"]);
  driverB = await addStaff(schoolB, "nts-driver-b", "DRIVER", []);
  myRouteId = await addRoute(schoolA, "NTS North", driver.id);
  await addRoute(schoolA, "NTS South", otherDriver.id);
  await addRoute(schoolB, "NTS B Route", driverB.id);
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("librarian", () => {
  it("sees the library and none of students, transport or fees", async () => {
    const held = await staffGrants(librarian.ctx);
    expect(held).toEqual(STAFF_ROLE_DEFAULT_GRANTS.LIBRARIAN);
    const nav = hrefs(held);
    expect(nav).toContain("/staff/library");
    expect(nav).not.toContain("/staff/students");
    expect(nav).not.toContain("/staff/transport");
    expect(nav).not.toContain("/staff/fees");
  });

  it("is refused the students directory, transport and the fee desk on the server", async () => {
    await expect(listBooks(librarian.ctx)).resolves.toBeDefined();
    await expect(staffStudentDirectory(librarian.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRoutes(librarian.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listFeePositions(librarian.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(feeDeskToday(librarian.ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("accountant", () => {
  it("gets the fee desk and its day; library and transport stay closed", async () => {
    const nav = hrefs(await staffGrants(accountant.ctx));
    expect(nav).toContain("/staff/fees");
    expect(nav).not.toContain("/staff/library");
    expect(nav).not.toContain("/staff/transport");
    expect(nav).not.toContain("/staff/students");

    const desk = await feeDeskToday(accountant.ctx);
    expect(desk).toMatchObject({ receipts: expect.any(Number), totalMinor: expect.any(Number) });
    await expect(listBooks(accountant.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRoutes(accountant.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffStudentDirectory(accountant.ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is not pre-ticked for the student directory when added", () => {
    expect(STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT).toEqual(["fees.view", "fees.collect"]);
  });
});

describe("driver", () => {
  it("sees their own route, stops in order, with the driver role's default grants", async () => {
    expect(await staffGrants(driver.ctx)).toEqual(STAFF_ROLE_DEFAULT_GRANTS.DRIVER);
    const routes = await myAssignedRoutes(driver.ctx);
    expect(routes.map((route) => route.id)).toEqual([myRouteId]);
    expect(routes[0]!.as).toBe("DRIVER");
    expect(routes[0]!.vehicle?.registrationNo).toBe("NTS North-REG");
    expect(routes[0]!.stops.map((stop) => stop.name)).toEqual(["NTS North market", "NTS North gate"]);
  });

  it("needs View transport for the school's other routes, and never gets fees or library", async () => {
    await expect(listRoutes(driver.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(hrefs(await staffGrants(driver.ctx), true)).not.toContain("/staff/transport");

    expect(hrefs(await staffGrants(transportDesk.ctx))).toContain("/staff/transport");
    expect((await listRoutes(transportDesk.ctx)).length).toBeGreaterThanOrEqual(2);
    expect(await myAssignedRoutes(transportDesk.ctx)).toEqual([]);

    for (const who of [driver, transportDesk]) {
      await expect(feeDeskToday(who.ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listBooks(who.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("an inactive driver holds nothing", async () => {
    await prisma.staffMember.update({ where: { id: transportDesk.id }, data: { status: "SUSPENDED" } });
    try {
      expect(await staffGrants(transportDesk.ctx)).toEqual([]);
      await expect(listRoutes(transportDesk.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      await prisma.staffMember.update({ where: { id: transportDesk.id }, data: { status: "ACTIVE" } });
    }
  });
});

describe("staff attendance", () => {
  it("the admin marks every staff member and sees today's overview, a month and leave", async () => {
    const date = today();
    await markStaffAttendance(adminOf(schoolA), {
      date,
      entries: [
        { staffMemberId: librarian.id, status: "PRESENT", remarks: null },
        { staffMemberId: accountant.id, status: "LATE", remarks: "Bus delay" },
        { staffMemberId: driver.id, status: "ABSENT", remarks: null },
        { staffMemberId: otherDriver.id, status: "ON_LEAVE", remarks: null },
      ],
    });

    const overview = await staffOverview(adminOf(schoolA));
    expect(overview.counts).toMatchObject({ total: 5, present: 1, late: 1, absent: 1, onLeave: 1, notMarked: 1 });
    expect(overview.today.get(accountant.id)).toBe("LATE");
    expect(overview.byRole).toEqual(
      expect.arrayContaining([
        { role: "DRIVER", count: 3 },
        { role: "LIBRARIAN", count: 1 },
        { role: "ACCOUNTANT", count: 1 },
      ]),
    );

    const record = await staffRecord(adminOf(schoolA), accountant.id);
    expect(record.days).toHaveLength(1);
    expect(record.days[0]).toMatchObject({ status: "LATE", remarks: "Bus delay" });
    expect(record.counts.LATE).toBe(1);
  });

  it("only the School Admin manages it — not staff, not teachers", async () => {
    await expect(staffOverview(librarian.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffRecord(librarian.ctx, accountant.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffOverview(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      markStaffAttendance(teacherOf(schoolA), { date: today(), entries: [{ staffMemberId: librarian.id, status: "ABSENT", remarks: null }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      markStaffAttendance(librarian.ctx, { date: today(), entries: [{ staffMemberId: librarian.id, status: "PRESENT", remarks: null }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a staff member sees only their own register", async () => {
    const mine = await myStaffAttendance(accountant.ctx);
    expect(mine.rows.map((row) => row.status)).toEqual(["LATE"]);
    const theirs = await myStaffAttendance(driver.ctx);
    expect(theirs.rows.map((row) => row.status)).toEqual(["ABSENT"]);
  });
});

describe("tenant isolation", () => {
  it("school B never sees school A's staff, attendance or routes", async () => {
    await expect(staffRecord(adminOf(schoolB), accountant.id)).rejects.toBeInstanceOf(NotFoundError);
    const overview = await staffOverview(adminOf(schoolB));
    expect(overview.counts.total).toBe(1);
    expect(overview.today.has(accountant.id)).toBe(false);
    expect((await myAssignedRoutes(driverB.ctx)).map((route) => route.name)).toEqual(["NTS B Route"]);
    await expect(
      markStaffAttendance(adminOf(schoolB), { date: today(), entries: [{ staffMemberId: librarian.id, status: "ABSENT", remarks: null }] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("phone numbers", () => {
  it("a staff CSV import stores the standard form and refuses letters or extra digits", async () => {
    const bad = await importStaff(adminOf(schoolA), "Employee ID,First name,Last name,Role,Phone\nPH1,Ravi,Kumar,Peon,98765abcde\nPH2,Mohan,Lal,Peon,987654321012");
    expect(bad.created).toBe(0);
    expect(bad.errors.map((error) => error.line)).toEqual([2, 3]);
    expect(bad.errors[0]!.message).toMatch(/phone is invalid/);

    const good = await importStaff(adminOf(schoolA), "Employee ID,First name,Last name,Role,Phone\nPH3,Sita,Devi,Peon,098765 43210");
    expect(good.created).toBe(1);
    expect((await prisma.staffMember.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, employeeId: "PH3" } })).phone).toBe("+91 9876543210");
  });
});
