/**
 * Non-teaching staff, transport, library and inventory.
 *
 * Each module: its business rules on the server, CSV imports that save
 * nothing when a row is bad, School Admin–only management, and no reach into
 * another school — by id, by code or through a CSV.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { assetSchema, bookSchema, staffSchema, vehicleSchema } from "@/lib/validation/operations";
import { prisma } from "@/server/db/prisma";
import { bulkAssetStatus, getAsset, importAssets, listAssets, saveAsset } from "@/server/operations/inventory";
import { importBooks, issueBook, listBooks, myLoans, returnBook, saveBook } from "@/server/operations/library";
import { importStaff, listStaff, saveStaff } from "@/server/operations/staff";
import { addStop, assignTransport, childTransport, importTransport, listRoutes, saveRoute, saveVehicle } from "@/server/operations/transport";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let driverId: string;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("staff", () => {
  it("adds staff, refuses a duplicate employee ID, and is School Admin only", async () => {
    driverId = await saveStaff(adminOf(schoolA), staffSchema.parse({ employeeId: "DRV1", firstName: "Ramesh", lastName: "Yadav", role: "DRIVER" }));
    await expect(saveStaff(adminOf(schoolA), staffSchema.parse({ employeeId: "drv1", firstName: "X", lastName: "Y", role: "PEON" }))).resolves.toBeTruthy();
    await expect(saveStaff(adminOf(schoolA), staffSchema.parse({ employeeId: "DRV1", firstName: "X", lastName: "Y", role: "PEON" }))).rejects.toBeInstanceOf(ConflictError);
    await expect(listStaff(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listStaff(adminOf(schoolB))).map((row) => row.id)).not.toContain(driverId);
    // Editing another school's staff member by id finds nothing.
    await expect(
      saveStaff(adminOf(schoolB), { ...staffSchema.parse({ employeeId: "Z", firstName: "Z", lastName: "Z", role: "PEON" }), staffId: driverId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("imports only when every row is valid", async () => {
    const bad = "Employee ID,First name,Last name,Role\nATT1,Sita,Devi,Transport attendant\nDRV1,Dup,Id,Driver\nX9,No,Role,Pilot";
    const failed = await importStaff(adminOf(schoolA), bad);
    expect(failed.created).toBe(0);
    expect(failed.errors.map((error) => error.line)).toEqual([3, 4]);
    expect(await prisma.staffMember.count({ where: { schoolId: schoolA.schoolId, employeeId: "ATT1" } })).toBe(0);
    const good = await importStaff(adminOf(schoolA), "Employee ID,First name,Last name,Role,Phone\nATT1,Sita,Devi,Transport attendant,9876500001");
    expect(good).toEqual({ created: 1, errors: [] });
  });
});

describe("transport", () => {
  let routeId: string;
  let stopId: string;

  it("builds a route only from this school's vehicle and a real driver", async () => {
    const vehicleId = await saveVehicle(adminOf(schoolA), vehicleSchema.parse({ registrationNo: "mp09 ab 1234", type: "VAN", capacity: "2" }));
    const attendant = await prisma.staffMember.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, employeeId: "ATT1" } });
    // An attendant cannot be the driver.
    await expect(
      saveRoute(adminOf(schoolA), { routeId: null, name: "Route 1", vehicleId, driverId: attendant.id, attendantId: null, isActive: true, notes: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    routeId = await saveRoute(adminOf(schoolA), { routeId: null, name: "Route 1", vehicleId, driverId, attendantId: attendant.id, isActive: true, notes: null });
    await addStop(adminOf(schoolA), { routeId, name: "Main gate", sequence: 1, pickupMinute: 450, dropMinute: 870 });
    stopId = (await prisma.routeStop.findFirstOrThrow({ where: { routeId } })).id;
    // Another school cannot use A's vehicle or driver.
    await expect(
      saveRoute(adminOf(schoolB), { routeId: null, name: "Stolen", vehicleId, driverId: null, attendantId: null, isActive: true, notes: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("assigns students within the vehicle's capacity and shows parents only their child's route", async () => {
    await assignTransport(adminOf(schoolA), { routeId, stopId, studentIds: schoolA.studentIds.slice(0, 2), startDate: today() });
    await expect(
      assignTransport(adminOf(schoolA), { routeId, stopId, studentIds: [schoolA.studentIds[2]!], startDate: today() }),
    ).rejects.toThrow(/seats 2/);
    await expect(
      assignTransport(adminOf(schoolA), { routeId, stopId, studentIds: [schoolB.studentIds[0]!], startDate: today() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const [route] = await listRoutes(adminOf(schoolA));
    expect(route?.riders).toBe(2);

    const seen = await childTransport(parentOf(schoolA), schoolA.studentIds[0]!);
    expect(seen).toMatchObject({ route: "Route 1", stop: "Main gate", driver: { name: "Ramesh Yadav" } });
    // Scoped reads: school B's context cannot see A's child's transport.
    expect(await childTransport(parentOf(schoolB), schoolA.studentIds[0]!)).toBeNull();
  });

  it("imports assignments only when every row is valid", async () => {
    const student = await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[2]! } });
    const result = await importTransport(adminOf(schoolA), `Admission no.,Route,Stop\n${student.admissionNumber},Route 1,Main gate\nNOPE,Route 9,`);
    expect(result.assigned).toBe(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(2); // unknown student and route, plus the full van
  });
});

describe("library", () => {
  let bookId: string;

  it("issues within the copies available and the borrower's limit", async () => {
    bookId = await saveBook(adminOf(schoolA), bookSchema.parse({ title: "Wings of Fire", isbn: "978-81-7371-146-6", quantity: "1", isActive: "on" }));
    const admission = (await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[0]! } })).admissionNumber;
    const issue = await issueBook(adminOf(schoolA), { bookId, borrowerKind: "STUDENT", borrowerCode: admission, issuedOn: addDays(today(), -20), dueOn: addDays(today(), -6), notes: null });
    await expect(
      issueBook(adminOf(schoolA), { bookId, borrowerKind: "TEACHER", borrowerCode: "EMP001", issuedOn: today(), dueOn: addDays(today(), 7), notes: null }),
    ).rejects.toThrow(/No copy/);
    await expect(
      issueBook(adminOf(schoolA), { bookId, borrowerKind: "STUDENT", borrowerCode: admission, issuedOn: addDays(today(), 1), dueOn: addDays(today(), 7), notes: null }),
    ).rejects.toBeInstanceOf(AppError);
    expect((await listBooks(adminOf(schoolA))).find((book) => book.id === bookId)?.available).toBe(0);

    // The student sees their own loan; another school's admin cannot return it.
    expect((await myLoans(studentOf(schoolA))).map((loan) => loan.id)).toContain(issue.id);
    await expect(returnBook(adminOf(schoolB), { issueId: issue.id, returnedOn: today(), finePaid: false })).rejects.toBeInstanceOf(NotFoundError);

    // Six days late at ₹2 a day.
    const { fineMinor } = await returnBook(adminOf(schoolA), { issueId: issue.id, returnedOn: today(), finePaid: false });
    expect(fineMinor).toBe(6 * 200);
  });

  it("refuses a borrower from another school, and lowering copies below those on loan", async () => {
    const other = (await prisma.student.findUniqueOrThrow({ where: { id: schoolB.studentIds[0]! } })).admissionNumber;
    await prisma.student.update({ where: { id: schoolB.studentIds[0]! }, data: { admissionNumber: `${other}-ONLYB` } });
    await expect(
      issueBook(adminOf(schoolA), { bookId, borrowerKind: "STUDENT", borrowerCode: `${other}-ONLYB`, issuedOn: today(), dueOn: addDays(today(), 7), notes: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const admission = (await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[1]! } })).admissionNumber;
    await issueBook(adminOf(schoolA), { bookId, borrowerKind: "STUDENT", borrowerCode: admission, issuedOn: today(), dueOn: addDays(today(), 7), notes: null });
    await expect(saveBook(adminOf(schoolA), bookSchema.parse({ bookId, title: "Wings of Fire", isbn: "9788173711466", quantity: "0", isActive: "on" }))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("imports books, updating a known ISBN and refusing bad rows", async () => {
    const bad = await importBooks(adminOf(schoolA), "Title,ISBN,Quantity\nNew Book,123,2\n,9788173711466,x");
    expect(bad.errors.map((error) => error.line)).toEqual([2, 3]);
    const good = await importBooks(adminOf(schoolA), "Title,ISBN,Quantity,Shelf\nWings of Fire,9788173711466,4,C-1\nThe Guide,,2,");
    expect(good).toEqual({ created: 1, updated: 1, errors: [] });
    expect((await prisma.book.findUniqueOrThrow({ where: { id: bookId } })).quantity).toBe(4);
  });
});

describe("inventory", () => {
  let assetId: string;

  it("keeps a history of every change and refuses a future purchase date", async () => {
    expect(assetSchema.safeParse({ code: "X", name: "X", category: "OTHER", quantity: "1", purchaseDate: "2099-01-01" }).success).toBe(false);
    assetId = await saveAsset(adminOf(schoolA), assetSchema.parse({ code: "LAB-PC-1", name: "Desktop", category: "COMPUTER", quantity: "1", location: "Lab" }));
    await saveAsset(
      adminOf(schoolA),
      assetSchema.parse({ assetId, code: "LAB-PC-1", name: "Desktop", category: "COMPUTER", quantity: "1", location: "Lab", assignedTo: "IT", status: "IN_REPAIR" }),
    );
    const asset = await getAsset(adminOf(schoolA), assetId);
    expect(asset.events).toHaveLength(2);
    expect(asset.events[0]?.summary).toMatch(/In repair/);
    await expect(getAsset(adminOf(schoolB), assetId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("bulk-updates status inside the school only", async () => {
    await expect(bulkAssetStatus(adminOf(schoolB), { assetIds: [assetId], status: "LOST", note: null })).rejects.toBeInstanceOf(NotFoundError);
    await bulkAssetStatus(adminOf(schoolA), { assetIds: [assetId], status: "ACTIVE", note: "Repaired" });
    expect((await listAssets(adminOf(schoolA), { status: "ACTIVE" })).map((row) => row.id)).toContain(assetId);
    await expect(bulkAssetStatus(teacherOf(schoolA), { assetIds: [assetId], status: "LOST", note: null })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("imports assets only when every row is valid", async () => {
    const bad = await importAssets(adminOf(schoolA), "Code,Name,Category,Quantity\nLAB-PC-1,Dup,Computer,1\nCH-1,Chair,Seating,10");
    expect(bad.errors.map((error) => error.line)).toEqual([2, 3]);
    const good = await importAssets(adminOf(schoolA), "Code,Name,Category,Quantity,Location\nCH-1,Chair,Furniture,30,Class 10 A");
    expect(good).toEqual({ created: 1, errors: [] });
    expect((await getAsset(adminOf(schoolA), (await prisma.asset.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, code: "CH-1" } })).id)).events).toHaveLength(1);
  });
});
