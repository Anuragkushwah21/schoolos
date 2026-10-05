/**
 * Library: a lost or damaged copy leaves stock without deleting anything, its
 * open loan closes as "lost" (with an optional charge), it can come back; and
 * overdue books reach the student, their parent, the librarian and the office.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";

import { addDays, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { getAdminAlerts, getStaffAlerts, getStudentAlerts } from "@/server/alerts/feeds";
import { prisma } from "@/server/db/prisma";
import { bookCopies, issueBook, listLoans, markCopyCondition, overdueLoanCount, restoreCopy, saveBook } from "@/server/operations/library";
import { getParentAlerts } from "@/server/parent/alerts";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let librarianUserId: string;
let bookId: string;

const librarian = () => contextFor(schoolA, librarianUserId, "NON_TEACHING_STAFF");
const copies = () => prisma.bookCopy.findMany({ where: { bookId }, orderBy: { code: "asc" } });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const user = await prisma.user.create({ data: { email: "librarian@lost-test.test", passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: "Lib", lastName: "Rarian", schoolId: schoolA.schoolId, activatedAt: new Date() } });
  await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "LOST1", firstName: "Lib", lastName: "Rarian", role: "LIBRARIAN", grants: STAFF_ROLE_DEFAULT_GRANTS.LIBRARIAN } });
  librarianUserId = user.id;
  bookId = await saveBook(librarian(), { bookId: null, title: "Chemistry Class 10", author: null, isbn: null, category: null, publisher: null, shelf: null, quantity: 3, isActive: true } as never);
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("lost and damaged copies", () => {
  it("takes an issued copy out of stock, closes its loan as lost with a charge, and keeps the history", async () => {
    const [first, second] = await copies();
    // Issued three weeks ago, due a week ago: overdue.
    const loan = await issueBook(librarian(), { bookId, borrowerKind: "STUDENT", borrowerCode: "", studentId: schoolA.studentIds[0]!, issuedOn: addDays(today(), -21), dueOn: addDays(today(), -7), notes: null, copyId: first!.id } as never);
    expect(await overdueLoanCount(librarian())).toBe(1);

    await expect(markCopyCondition(teacherOf(schoolA), { copyId: first!.id, condition: "LOST", note: "Lost on the bus" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markCopyCondition(adminOf(schoolB), { copyId: first!.id, condition: "LOST", note: "x" })).rejects.toBeInstanceOf(NotFoundError);

    await markCopyCondition(librarian(), { copyId: first!.id, condition: "LOST", note: "Lost on the bus", chargeMinor: 25_000 });
    const issue = await prisma.bookIssue.findUniqueOrThrow({ where: { id: loan.id } });
    expect(issue).toMatchObject({ fineMinor: 25_000, finePaid: false });
    expect(issue.lostOn).not.toBeNull();
    expect(issue.returnedOn).not.toBeNull();
    // Still on record, now shown as lost — and no longer overdue.
    const history = await listLoans(librarian(), { bookId });
    expect(history.find((row) => row.id === loan.id)?.status).toBe("LOST");
    expect(await overdueLoanCount(librarian())).toBe(0);
    expect((await prisma.book.findUniqueOrThrow({ where: { id: bookId } })).quantity).toBe(2);
    expect((await bookCopies(librarian(), bookId)).find((copy) => copy.id === first!.id)).toMatchObject({ status: "LOST", conditionNote: "Lost on the bus" });
    // Cannot be lost twice, and a lost copy cannot be lent.
    await expect(markCopyCondition(librarian(), { copyId: first!.id, condition: "DAMAGED", note: "x" })).rejects.toBeInstanceOf(ConflictError);
    await expect(issueBook(librarian(), { bookId, borrowerKind: "STUDENT", borrowerCode: "", studentId: schoolA.studentIds[1]!, issuedOn: today(), dueOn: addDays(today(), 7), notes: null, copyId: first!.id } as never)).rejects.toThrow();

    // A damaged copy on the shelf, then repaired.
    await markCopyCondition(librarian(), { copyId: second!.id, condition: "DAMAGED", note: "Cover torn" });
    expect((await prisma.book.findUniqueOrThrow({ where: { id: bookId } })).quantity).toBe(1);
    await restoreCopy(librarian(), second!.id);
    expect((await prisma.bookCopy.findUniqueOrThrow({ where: { id: second!.id } })).status).toBe("AVAILABLE");
    expect((await prisma.book.findUniqueOrThrow({ where: { id: bookId } })).quantity).toBe(2);
    await expect(restoreCopy(librarian(), second!.id)).rejects.toBeInstanceOf(ConflictError);
    // Every copy row still exists.
    expect(await prisma.bookCopy.count({ where: { bookId } })).toBe(3);
  });
});

describe("overdue alerts", () => {
  it("tell the student, their parent, the librarian and the office — nobody in another school", async () => {
    const [, second] = await copies();
    await issueBook(librarian(), { bookId, borrowerKind: "STUDENT", borrowerCode: "", studentId: schoolA.studentIds[0]!, issuedOn: addDays(today(), -20), dueOn: addDays(today(), -3), notes: null, copyId: second!.id } as never);

    const student = await getStudentAlerts(contextFor(schoolA, schoolA.studentUserId, "STUDENT"));
    expect(student.find((alert) => alert.kind === "library-overdue")?.title).toMatch(/Chemistry Class 10/);
    const parent = await getParentAlerts(contextFor(schoolA, schoolA.parentUserId, "PARENT"));
    expect(parent.find((alert) => alert.kind === "library-overdue")?.detail).toMatch(/3 days late/);
    expect((await getStaffAlerts(librarian())).find((alert) => alert.kind === "library-overdue")?.title).toBe("1 library book is overdue");
    expect((await getAdminAlerts(adminOf(schoolA))).some((alert) => alert.kind === "library-overdue")).toBe(true);
    // School B hears nothing of School A's library.
    expect((await getAdminAlerts(adminOf(schoolB))).some((alert) => alert.kind === "library-overdue")).toBe(false);
  });
});
