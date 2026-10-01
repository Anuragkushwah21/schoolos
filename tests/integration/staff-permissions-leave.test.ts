/**
 * Staff leave, granular staff permissions, voided receipts, and the
 * substitute's record.
 *
 *   * Non-teaching staff apply for, see and cancel their own leave; the admin
 *     filters by employee and decides. Staff leave marks no teacher register.
 *   * "Collect fees" lets a staff login take payments and print receipts —
 *     nothing else in finance; without it, the fee desk is refused.
 *   * "Run the library" lets a staff login issue and return books; "View
 *     library" does not.
 *   * A voided receipt keeps its number and stops counting as paid.
 *   * Once a substitute is assigned, the absent teacher cannot overwrite the
 *     record of who took the class.
 *   * None of it crosses schools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, dayOfWeek, toDateInput, today } from "@/lib/dates";
import { leaveRequestSchema } from "@/lib/validation/leave";
import { bookSchema, issueBookSchema } from "@/lib/validation/operations";
import { paymentSchema } from "@/lib/validation/school";
import type { TenantContext } from "@/server/auth/current-user";
import { recordActivity } from "@/server/classwork/activities";
import { assignSubstitute } from "@/server/classwork/substitutes";
import { prisma } from "@/server/db/prisma";
import { getStudentFees, listFeePositions, recordPayment, voidPayment } from "@/server/finance/fees";
import { getReceipt } from "@/server/finance/receipts";
import { listExpenses } from "@/server/finance/expenses";
import { bookCategories, childLoans, issueBook, listBooks, myLoans, renewLoan, saveBook, searchBorrowers } from "@/server/operations/library";
import { listRoutes } from "@/server/operations/transport";
import { applyForLeave, cancelLeave, decideLeave, listLeaveRequests, listMyLeave } from "@/server/staff/leave";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let accountant: { id: string; ctx: TenantContext };
let librarian: { id: string; ctx: TenantContext };
let reader: { id: string; ctx: TenantContext };

async function addStaff(school: SeededSchool, key: string, permissions: Array<"COLLECT_FEES" | "MANAGE_LIBRARY" | "VIEW_LIBRARY" | "VIEW_STUDENTS">) {
  const user = await prisma.user.create({
    data: { email: `${key}@iso-test-a.test`, passwordHash: "not-a-real-hash", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Staff", schoolId: school.schoolId },
  });
  const staff = await prisma.staffMember.create({
    data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Staff", role: "OTHER", permissions },
  });
  return { id: staff.id, ctx: contextFor(school, user.id, "NON_TEACHING_STAFF") };
}

async function addTeacher(school: SeededSchool, key: string) {
  const user = await prisma.user.create({
    data: { email: `${key}@iso-test-a.test`, passwordHash: "not-a-real-hash", role: "TEACHER", firstName: key, lastName: "Teacher", schoolId: school.schoolId },
  });
  const teacher = await prisma.teacher.create({
    data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Teacher" },
  });
  return { id: teacher.id, ctx: contextFor(school, user.id, "TEACHER") };
}

const leave = (start: Date, end: Date) =>
  leaveRequestSchema.parse({ type: "CASUAL", startDate: toDateInput(start), endDate: toDateInput(end), reason: "Family function" });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  accountant = await addStaff(schoolA, "accountant", ["COLLECT_FEES"]);
  librarian = await addStaff(schoolA, "librarian", ["MANAGE_LIBRARY"]);
  reader = await addStaff(schoolA, "reader", ["VIEW_LIBRARY"]);
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("staff leave", () => {
  it("lets a staff member apply, see and cancel their own leave; the admin filters and decides", async () => {
    const start = addDays(today(), 10);
    const { id } = await applyForLeave(accountant.ctx, leave(start, addDays(start, 1)));
    const mine = await listMyLeave(accountant.ctx);
    expect(mine.map((row) => row.id)).toEqual([id]);
    // Another staff member cannot see or cancel it.
    expect(await listMyLeave(librarian.ctx)).toEqual([]);
    await expect(cancelLeave(librarian.ctx, id)).rejects.toBeInstanceOf(NotFoundError);

    const filtered = await listLeaveRequests(adminOf(schoolA), { staffMemberId: accountant.id });
    expect(filtered.map((row) => row.id)).toEqual([id]);
    expect(await listLeaveRequests(adminOf(schoolA), { teacherId: schoolA.teacherId })).toEqual([]);

    await decideLeave(adminOf(schoolA), { leaveIds: [id], decision: "APPROVED", note: "Enjoy" });
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "APPROVED", teacherId: null, staffMemberId: accountant.id });
    // Staff leave never writes to the teachers' register.
    expect(await prisma.teacherAttendance.count({ where: { schoolId: schoolA.schoolId } })).toBe(0);

    // Overlapping leave is refused for staff as for teachers.
    await expect(applyForLeave(accountant.ctx, leave(start, start))).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps another school out", async () => {
    await expect(decideLeave(adminOf(schoolB), { leaveIds: [(await listMyLeave(accountant.ctx))[0]!.id], decision: "REJECTED", note: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await listLeaveRequests(adminOf(schoolB), { staffMemberId: accountant.id })).toEqual([]);
  });
});

describe("collect fees permission", () => {
  const payment = (receiptNo: string) =>
    paymentSchema.parse({ studentId: schoolA.studentIds[0], amountMinor: "500", paidOn: toDateInput(today()), method: "CASH", receiptNo });

  it("lets a fee collector take a payment and print its receipt — and nothing more", async () => {
    const { id } = await recordPayment(accountant.ctx, payment("STAFF-1"));
    expect((await getReceipt(accountant.ctx, id)).payment.receiptNo).toBe("STAFF-1");
    expect((await listFeePositions(accountant.ctx)).rows.length).toBeGreaterThan(0);
    // Voiding, expenses and settings stay with the School Admin.
    await expect(voidPayment(accountant.ctx, id, "oops")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listExpenses(accountant.ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses staff without the permission, and teachers", async () => {
    await expect(recordPayment(librarian.ctx, payment("STAFF-2"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getStudentFees(reader.ctx, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(teacherOf(schoolA), payment("STAFF-3"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot reach another school's student", async () => {
    await expect(
      recordPayment(accountant.ctx, paymentSchema.parse({ studentId: schoolB.studentIds[0], amountMinor: "500", paidOn: toDateInput(today()), method: "CASH", receiptNo: "X-1" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("voided receipts", () => {
  it("keep their number, show as void, and stop counting", async () => {
    const admin = adminOf(schoolA);
    const { id } = await recordPayment(admin, paymentSchema.parse({ studentId: schoolA.studentIds[1], amountMinor: "700", paidOn: toDateInput(today()), method: "UPI", receiptNo: "VOID-1" }));
    const before = await getStudentFees(admin, schoolA.studentIds[1]!);
    await voidPayment(admin, id, "Wrong student");
    const after = await getStudentFees(admin, schoolA.studentIds[1]!);
    expect(after.summary.paidMinor).toBe(before.summary.paidMinor - 70_000);
    expect(await prisma.feePayment.count({ where: { id } })).toBe(1);
    expect((await getReceipt(admin, id)).payment.voided?.reason).toBe("Wrong student");
    await expect(voidPayment(adminOf(schoolB), id, "probe")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("run the library permission", () => {
  it("lets the librarian add and issue books, but not a read-only staff member", async () => {
    const bookId = await saveBook(librarian.ctx, bookSchema.parse({ title: "Panchatantra", quantity: "2", isActive: "on" }));
    const issue = issueBookSchema.parse({
      bookId,
      borrowerKind: "STUDENT",
      borrowerCode: "ADM1",
      issuedOn: toDateInput(today()),
      dueOn: toDateInput(addDays(today(), 14)),
    });
    await issueBook(librarian.ctx, issue);
    expect((await listBooks(reader.ctx)).find((book) => book.id === bookId)?.available).toBe(1);
    await expect(issueBook(reader.ctx, issue)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveBook(accountant.ctx, bookSchema.parse({ title: "Nope", quantity: "1" }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the substitute's record", () => {
  it("cannot be overwritten by the absent teacher", async () => {
    // The most recent school day, so both can try to write it up.
    let day = today();
    while (dayOfWeek(day) === "SUNDAY") day = addDays(day, -1);
    const substitute = await addTeacher(schoolA, "stand-in");
    const slot = await prisma.timetableSlot.create({
      data: {
        schoolId: schoolA.schoolId,
        academicSessionId: schoolA.academicSessionId,
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        teacherId: schoolA.teacherId,
        dayOfWeek: dayOfWeek(day),
        startMinute: 600,
        endMinute: 645,
      },
    });
    await assignSubstitute(adminOf(schoolA), { timetableSlotId: slot.id, date: day, teacherId: substitute.id });
    await recordActivity(substitute.ctx, { timetableSlotId: slot.id, date: day, status: "COMPLETED", topic: "Fractions", notes: null, importantPoints: null });

    await expect(
      recordActivity(teacherOf(schoolA), { timetableSlotId: slot.id, date: day, status: "COMPLETED", topic: "Overwrite", notes: null, importantPoints: null }),
    ).rejects.toBeInstanceOf(ConflictError);

    const record = await prisma.classSession.findFirstOrThrow({ where: { timetableSlotId: slot.id, date: day } });
    expect(record).toMatchObject({ status: "SUBSTITUTE", scheduledTeacherId: schoolA.teacherId, actualTeacherId: substitute.id, topic: "Fractions" });
  });
});

describe("library desk", () => {
  it("renews a loan within the limit, and only for the desk", async () => {
    const bookId = await saveBook(librarian.ctx, bookSchema.parse({ title: "Godan", quantity: "1", isActive: "on" }));
    const { id } = await issueBook(
      librarian.ctx,
      issueBookSchema.parse({ bookId, borrowerKind: "STUDENT", borrowerCode: "ADM2", issuedOn: toDateInput(today()), dueOn: toDateInput(addDays(today(), 7)) }),
    );
    await renewLoan(librarian.ctx, { issueId: id, dueOn: addDays(today(), 21) });
    expect((await prisma.bookIssue.findUniqueOrThrow({ where: { id } })).dueOn).toEqual(addDays(today(), 21));
    await expect(renewLoan(librarian.ctx, { issueId: id, dueOn: addDays(today(), 90) })).rejects.toThrow(/at most/);
    await expect(renewLoan(reader.ctx, { issueId: id, dueOn: addDays(today(), 25) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(renewLoan(adminOf(schoolB), { issueId: id, dueOn: addDays(today(), 25) })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("finds borrowers with only what the desk needs, inside the school", async () => {
    const hits = await searchBorrowers(librarian.ctx, "Aarav");
    expect(hits.length).toBeGreaterThan(0);
    expect(Object.keys(hits[0]!).sort()).toEqual(["booksOut", "code", "detail", "id", "kind", "name"]);
    expect(JSON.stringify(hits)).not.toMatch(/phone|guardian|parent/i);
    expect(await searchBorrowers(adminOf(schoolB), "Aarav")).toEqual([]);
    await expect(searchBorrowers(reader.ctx, "Aarav")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(searchBorrowers(teacherOf(schoolA), "Aarav")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps the librarian out of transport, finance and other schools' books", async () => {
    await expect(listRoutes(librarian.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listExpenses(librarian.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getStudentFees(librarian.ctx, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bookCategories(contextFor(schoolA, schoolA.parentUserId, "PARENT"))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listBooks(librarian.ctx)).every((book) => book.title !== "B-only")).toBe(true);
    const bBook = await prisma.book.create({ data: { schoolId: schoolB.schoolId, title: "B-only", quantity: 1 } });
    await expect(
      issueBook(librarian.ctx, issueBookSchema.parse({ bookId: bBook.id, borrowerKind: "STUDENT", borrowerCode: "ADM1", issuedOn: toDateInput(today()), dueOn: toDateInput(addDays(today(), 7)) })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets students and parents only read their own", async () => {
    const student = contextFor(schoolA, schoolA.studentUserId, "STUDENT");
    await expect(
      issueBook(student, issueBookSchema.parse({ bookId: "x", borrowerKind: "STUDENT", borrowerCode: "ADM1", issuedOn: toDateInput(today()), dueOn: toDateInput(addDays(today(), 7)) })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await myLoans(student)).every((loan) => loan.student?.admissionNumber === "ADM1")).toBe(true);
    const parent = contextFor(schoolA, schoolA.parentUserId, "PARENT");
    expect((await childLoans(parent, schoolA.studentIds[1]!)).every((loan) => loan.student?.admissionNumber === "ADM2")).toBe(true);
    await expect(childLoans(parent, schoolB.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
  });
});
