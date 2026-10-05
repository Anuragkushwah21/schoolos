/**
 * The Librarian's reach and the library's permanent issue history.
 *
 *   * A Librarian never holds "View students" or "View transport", even when
 *     an old record still has them ticked — sidebar, pages and services all
 *     refuse — and saving the record drops them. Borrower search for the
 *     issue desk keeps working.
 *   * Every issue is its own record: who issued it and when, the borrower's
 *     class on that day, the copy, due date, and on return when and by whom.
 *     A copy issued again gets a new record; the old one is never touched.
 *   * Issued / Returned / Overdue / Lost / Damaged filters, search by
 *     student, admission no., book or copy code, and history per copy and
 *     per student.
 *   * A student with library history cannot be erased, and none of it crosses
 *     schools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "@/lib/errors";
import { addDays, today } from "@/lib/dates";
import { staffNav } from "@/lib/nav";
import { staffSchema } from "@/lib/validation/operations";
import type { TenantContext } from "@/server/auth/current-user";
import { staffGrants } from "@/server/auth/staff-access";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import { prisma } from "@/server/db/prisma";
import { issueBook, listLoans, markCopyCondition, returnBook, saveBook, searchBorrowers } from "@/server/operations/library";
import { saveStaffDetails } from "@/server/operations/staff";
import { listRoutes } from "@/server/operations/transport";
import { deleteStudent } from "@/server/people/students";
import { searchSchool } from "@/server/search/service";
import { staffStudentDirectory } from "@/server/staff/portal";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let librarianUserId: string;
let librarianStaffId: string;
let bookId: string;
let copies: Array<{ id: string; code: string }>;

const librarian = (): TenantContext => contextFor(schoolA, librarianUserId, "NON_TEACHING_STAFF");
const issue = (copyId: string, studentId: string, overrides: Record<string, unknown> = {}) =>
  issueBook(librarian(), { bookId, copyId, borrowerKind: "STUDENT", borrowerCode: "", studentId, issuedOn: today(), dueOn: addDays(today(), 7), notes: null, ...overrides });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // A librarian whose record still carries Students and Transport from before.
  const user = await prisma.user.create({
    data: { email: "librarian@lib-history.test", passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: "Asha", lastName: "Verma", schoolId: schoolA.schoolId, activatedAt: new Date() },
  });
  const staff = await prisma.staffMember.create({
    data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "LIBH1", firstName: "Asha", lastName: "Verma", role: "LIBRARIAN", grants: [...STAFF_ROLE_DEFAULT_GRANTS.LIBRARIAN, "students.directory", "students.contact", "transport.routes"] },
  });
  librarianUserId = user.id;
  librarianStaffId = staff.id;
  bookId = await saveBook(librarian(), { bookId: null, title: "Wings of Fire", author: "A. P. J. Abdul Kalam", isbn: null, category: null, publisher: null, shelf: null, quantity: 4, isActive: true } as never);
  copies = await prisma.bookCopy.findMany({ where: { bookId }, orderBy: { code: "asc" }, select: { id: true, code: true } });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("librarian permissions", () => {
  it("ignores Students and Transport left ticked on a librarian's record, everywhere", async () => {
    expect(await staffGrants(librarian())).toEqual(STAFF_ROLE_DEFAULT_GRANTS.LIBRARIAN);
    const nav = staffNav(await staffGrants(librarian())).map((item) => item.href);
    expect(nav).toContain("/staff/library");
    expect(nav).not.toContain("/staff/students");
    expect(nav).not.toContain("/staff/transport");

    await expect(staffStudentDirectory(librarian())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRoutes(librarian())).rejects.toBeInstanceOf(ForbiddenError);
    // The header search gives a librarian no students either.
    expect(await searchSchool(librarian(), "Student")).toEqual([]);
  });

  it("keeps the issue desk's own borrower search", async () => {
    const student = await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[0]! }, select: { admissionNumber: true } });
    const hits = await searchBorrowers(librarian(), student.admissionNumber);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("drops the excluded grants when the record is saved", async () => {
    // Old permission names from an API client: Students and Transport are dropped, the library kept.
    const input = staffSchema.parse({ staffId: librarianStaffId, employeeId: "LIBH1", firstName: "Asha", lastName: "Verma", role: "LIBRARIAN", permissions: ["VIEW_STUDENTS", "VIEW_TRANSPORT", "MANAGE_LIBRARY"] });
    await saveStaffDetails(adminOf(schoolA), input);
    const saved = await prisma.staffMember.findUniqueOrThrow({ where: { id: librarianStaffId }, select: { grants: true } });
    expect(saved.grants).toEqual(["library.view", "library.circulation", "library.books.create", "library.books.edit", "library.copies", "library.fines"]);
  });
});

describe("issue history", () => {
  it("records who issued and returned, when, and the class on the day — and keeps it when the copy goes out again", async () => {
    const [copy] = copies;
    const first = await issue(copy!.id, schoolA.studentIds[0]!);
    // A copy out on loan cannot be issued to a second student.
    await expect(issue(copy!.id, schoolA.studentIds[1]!)).rejects.toBeInstanceOf(ConflictError);

    await returnBook(adminOf(schoolA), { issueId: first.id, returnedOn: today(), finePaid: false });
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: copy!.id } })).status).toBe("AVAILABLE");

    const second = await issue(copy!.id, schoolA.studentIds[1]!);
    const history = await listLoans(librarian(), { copyId: copy!.id, view: "all" });
    expect(history.map((row) => row.id)).toEqual([second.id, first.id]);

    const old = history.find((row) => row.id === first.id)!;
    expect(old).toMatchObject({ status: "RETURNED", copyCode: copy!.code, issuedByName: "Asha Verma", returnedByName: expect.any(String) });
    expect(old.returnedAt).toBeInstanceOf(Date);
    expect(old.borrower.code).toBeTruthy();
    expect(old.borrower.group).toBeTruthy();

    const raw = await prisma.bookIssue.findUniqueOrThrow({ where: { id: first.id } });
    expect(raw).toMatchObject({ issuedById: librarianUserId, returnedById: schoolA.adminUserId, studentId: schoolA.studentIds[0] });
    expect(raw.borrowerGroup).toBe(old.borrower.group);

    await returnBook(librarian(), { issueId: second.id, returnedOn: today(), finePaid: false });
    expect((await prisma.bookIssue.findUniqueOrThrow({ where: { id: second.id } })).returnedById).toBe(librarianUserId);
    // Returning the second loan did not touch the first.
    expect(await prisma.bookIssue.findUniqueOrThrow({ where: { id: first.id } })).toEqual(raw);
  });

  it("tells lost from damaged, and each filter shows only its own", async () => {
    const lostLoan = await issue(copies[1]!.id, schoolA.studentIds[0]!);
    const damagedLoan = await issue(copies[2]!.id, schoolA.studentIds[0]!);
    await markCopyCondition(librarian(), { copyId: copies[1]!.id, condition: "LOST", note: "Lost on the bus", chargeMinor: 30_000 });
    await markCopyCondition(librarian(), { copyId: copies[2]!.id, condition: "DAMAGED", note: "Cover torn" });

    const ids = async (view: "open" | "returned" | "lost" | "damaged" | "overdue") => (await listLoans(librarian(), { bookId, view })).map((row) => row.id);
    expect(await ids("lost")).toEqual([lostLoan.id]);
    expect(await ids("damaged")).toEqual([damagedLoan.id]);
    expect(await ids("returned")).not.toContain(lostLoan.id);
    expect(await ids("returned")).not.toContain(damagedLoan.id);
    expect(await ids("open")).toEqual([]);

    const all = await listLoans(librarian(), { bookId, view: "all" });
    expect(all.find((row) => row.id === lostLoan.id)).toMatchObject({ status: "LOST", fineMinor: 30_000, returnedByName: "Asha Verma" });
    expect(all.find((row) => row.id === damagedLoan.id)).toMatchObject({ status: "DAMAGED" });
  });

  it("shows a book still out past its due date as overdue", async () => {
    const late = await issue(copies[3]!.id, schoolA.studentIds[1]!, { issuedOn: addDays(today(), -20), dueOn: addDays(today(), -5) });
    const overdue = await listLoans(librarian(), { bookId, view: "overdue" });
    expect(overdue.map((row) => row.id)).toEqual([late.id]);
    expect(overdue[0]!.status).toBe("OVERDUE");
  });

  it("searches by student, admission no., book and copy code, and lists a student's whole history", async () => {
    const student = await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[0]! }, select: { firstName: true, admissionNumber: true } });
    const byAdmission = await listLoans(librarian(), { view: "all", q: student.admissionNumber });
    expect(byAdmission.length).toBe(3);
    expect(byAdmission.every((row) => row.borrower.code === student.admissionNumber)).toBe(true);
    expect((await listLoans(librarian(), { view: "all", q: copies[0]!.code })).every((row) => row.copyCode === copies[0]!.code)).toBe(true);
    expect((await listLoans(librarian(), { view: "all", q: "wings of" })).length).toBe(5);

    const own = await listLoans(adminOf(schoolA), { studentId: schoolA.studentIds[0]!, view: "all" });
    expect(own.map((row) => row.status).sort()).toEqual(["DAMAGED", "LOST", "RETURNED"]);
  });

  it("a student with library history cannot be erased", async () => {
    await expect(deleteStudent(adminOf(schoolA), schoolA.studentIds[0]!)).rejects.toThrow(/library loan/);
    expect(await prisma.bookIssue.count({ where: { studentId: schoolA.studentIds[0]! } })).toBe(3);
  });

  it("none of it is visible to another school", async () => {
    expect(await listLoans(adminOf(schoolB), { view: "all" })).toEqual([]);
    expect(await listLoans(adminOf(schoolB), { copyId: copies[0]!.id, view: "all" })).toEqual([]);
    expect(await listLoans(adminOf(schoolB), { view: "all", q: copies[0]!.code })).toEqual([]);
  });
});
