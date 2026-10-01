/**
 * Librarian book issue with physical copies, profile photos for every role,
 * and student leave from parents (and students) to the class teacher.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { studentLeaveSchema } from "@/lib/validation/student-leave";
import { getTeacherAlerts } from "@/server/alerts/feeds";
import { getRegister } from "@/server/attendance/register";
import { applyStudentLeave, cancelStudentLeave, decideStudentLeave, listStudentLeaves } from "@/server/attendance/student-leave";
import { assertAdminOrStaffPermission, staffPermissions } from "@/server/auth/staff-access";
import { prisma } from "@/server/db/prisma";
import {
  childLoans,
  issuableBooks,
  issueBook,
  listLoans,
  myLoans,
  returnBook,
  saveBook,
  saveLibraryRules,
  searchBorrowers,
} from "@/server/operations/library";
import { getParentAlerts } from "@/server/parent/alerts";
import { readPhoto, removePhoto, selfPhotoUrl, selfTarget, setPhoto } from "@/server/people/photos";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { pngFile } from "../helpers/image";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let librarianUserId: string;
let bookId: string;
let otherBookId: string;

const librarian = () => contextFor(schoolA, librarianUserId, "NON_TEACHING_STAFF");
const parentA = () => contextFor(schoolA, schoolA.parentUserId, "PARENT");
const studentA = () => contextFor(schoolA, schoolA.studentUserId, "STUDENT");
const issue = (overrides: Record<string, unknown> = {}) => ({
  bookId,
  borrowerKind: "STUDENT" as const,
  borrowerCode: "",
  studentId: schoolA.studentIds[0]!,
  issuedOn: today(),
  dueOn: addDays(today(), 7),
  notes: null,
  ...overrides,
});
const copiesOf = (id: string) => prisma.bookCopy.findMany({ where: { bookId: id }, orderBy: { code: "asc" } });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // A librarian whose "Run the library" box was left unticked — as found in a real school.
  const user = await prisma.user.create({ data: { email: "librarian@lib-test.test", passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: "Neha", lastName: "Sharma", schoolId: schoolA.schoolId, activatedAt: new Date() } });
  await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "LIB1", firstName: "Neha", lastName: "Sharma", role: "LIBRARIAN", permissions: ["VIEW_LIBRARY"] } });
  librarianUserId = user.id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------
// Library
// -----------------------------------------------------------------------------

describe("librarian book issue", () => {
  it("a Librarian always runs the library — and nothing else", async () => {
    expect(await staffPermissions(librarian())).toEqual(expect.arrayContaining(["MANAGE_LIBRARY"]));
    await expect(assertAdminOrStaffPermission(librarian(), "COLLECT_FEES")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertAdminOrStaffPermission(librarian(), "VIEW_STUDENTS")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertAdminOrStaffPermission(librarian(), "VIEW_TRANSPORT")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("adds a book as numbered physical copies", async () => {
    bookId = await saveBook(librarian(), { bookId: null, title: "Physics Class 9", author: null, isbn: null, category: null, publisher: null, shelf: null, quantity: 3, isActive: true } as never);
    otherBookId = await saveBook(librarian(), { bookId: null, title: "Maths Class 9", author: null, isbn: null, category: null, publisher: null, shelf: null, quantity: 1, isActive: true } as never);
    expect((await copiesOf(bookId)).map((copy) => [copy.code, copy.status])).toEqual([
      ["BK-0001", "AVAILABLE"],
      ["BK-0002", "AVAILABLE"],
      ["BK-0003", "AVAILABLE"],
    ]);
  });

  it("finds students by name, admission number, or class and section", async () => {
    const byClass = await searchBorrowers(librarian(), "10-A");
    expect(byClass.length).toBeGreaterThan(0);
    expect(byClass.every((row) => row.kind === "STUDENT" && row.detail.startsWith("Class 10 – A"))).toBe(true);
    const admission = (await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[0] } })).admissionNumber;
    expect((await searchBorrowers(librarian(), admission)).map((row) => row.id)).toContain(schoolA.studentIds[0]);
    // Only this school's students.
    const bName = (await prisma.student.findUniqueOrThrow({ where: { id: schoolB.studentIds[0] } })).firstName;
    expect((await searchBorrowers(librarian(), bName)).map((row) => row.id)).not.toContain(schoolB.studentIds[0]);
  });

  it("issues an available copy to the chosen student; that copy is no longer available", async () => {
    const [first] = await copiesOf(bookId);
    const issued = await issueBook(librarian(), issue({ copyId: first!.id }));
    expect(issued.copyCode).toBe("BK-0001");
    expect((await prisma.bookIssue.findUniqueOrThrow({ where: { id: issued.id } })).studentId).toBe(schoolA.studentIds[0]);
    expect((await copiesOf(bookId))[0]!.status).toBe("ISSUED");
    const offered = (await issuableBooks(librarian())).find((book) => book.value === bookId)!;
    expect(offered.copies.map((copy) => copy.label)).toEqual(["BK-0002", "BK-0003"]);
  });

  it("never issues the same copy twice — even at the same moment", async () => {
    const [first, second] = await copiesOf(bookId);
    await expect(issueBook(librarian(), issue({ copyId: first!.id, studentId: schoolA.studentIds[1] }))).rejects.toBeInstanceOf(ConflictError);
    const results = await Promise.allSettled([
      issueBook(librarian(), issue({ copyId: second!.id, studentId: schoolA.studentIds[1] })),
      issueBook(librarian(), issue({ copyId: second!.id, studentId: schoolA.studentIds[2] })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.bookIssue.count({ where: { copyId: second!.id, returnedOn: null } })).toBe(1);
  });

  it("refuses a copy of another book, another school's student, a student who has left, and over the limit", async () => {
    const [mathsCopy] = await copiesOf(otherBookId);
    const [, , third] = await copiesOf(bookId);
    await expect(issueBook(librarian(), issue({ copyId: mathsCopy!.id }))).rejects.toBeInstanceOf(AppError);
    await expect(issueBook(librarian(), issue({ copyId: third!.id, studentId: schoolB.studentIds[0] }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(issueBook(contextFor(schoolB, schoolB.adminUserId, "SCHOOL_ADMIN"), issue({ copyId: third!.id }))).rejects.toBeInstanceOf(NotFoundError);

    await saveLibraryRules(adminOf(schoolA), { loanDays: 14, maxLoans: 1, finePerDayRupees: 2 });
    await expect(issueBook(librarian(), issue({ copyId: third!.id }))).rejects.toThrow(/limit 1/);
    await saveLibraryRules(adminOf(schoolA), { loanDays: 14, maxLoans: 3, finePerDayRupees: 2 });
    await expect(saveLibraryRules(librarian(), { loanDays: 14, maxLoans: 3, finePerDayRupees: 2 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows the loan to the student and to the parent, with the copy and status", async () => {
    const mine = await myLoans(studentA());
    expect(mine[0]).toMatchObject({ copyCode: "BK-0001", status: "ISSUED" });
    expect((await childLoans(parentA(), schoolA.studentIds[0]!))[0]).toMatchObject({ copyCode: "BK-0001", status: "ISSUED" });
  });

  it("returns a book: the copy is available again", async () => {
    const [loan] = (await listLoans(librarian(), { view: "open" })).filter((row) => row.copyCode === "BK-0001");
    await returnBook(librarian(), { issueId: loan!.id, returnedOn: today(), finePaid: false });
    expect((await copiesOf(bookId))[0]!.status).toBe("AVAILABLE");
    expect((await myLoans(studentA()))[0]).toMatchObject({ status: "RETURNED" });
    await expect(returnBook(librarian(), { issueId: loan!.id, returnedOn: today(), finePaid: false })).rejects.toBeInstanceOf(ConflictError);
  });

  it("marks an unreturned book past its due date OVERDUE — and never a returned one", async () => {
    const [first] = await copiesOf(bookId);
    const late = await issueBook(librarian(), issue({ copyId: first!.id, issuedOn: addDays(today(), -20), dueOn: addDays(today(), -5) }));
    const overdue = await listLoans(librarian(), { view: "overdue" });
    expect(overdue.find((row) => row.id === late.id)).toMatchObject({ status: "OVERDUE", overdue: true });
    const { fineMinor } = await returnBook(librarian(), { issueId: late.id, returnedOn: today(), finePaid: false });
    expect(fineMinor).toBe(5 * 200);
    const after = (await listLoans(librarian(), { view: "returned" })).find((row) => row.id === late.id);
    expect(after).toMatchObject({ status: "RETURNED", overdue: false });
  });

  it("another school never sees this library", async () => {
    expect((await listLoans(adminOf(schoolB))).length).toBe(0);
    expect(await issuableBooks(adminOf(schoolB))).toEqual([]);
  });

  it("the quantity never drops below the copies out", async () => {
    const [, second] = await copiesOf(bookId); // BK-0002 is still out from the race above
    expect(second!.status).toBe("ISSUED");
    await expect(saveBook(adminOf(schoolA), { bookId, title: "Physics Class 9", author: null, isbn: null, category: null, publisher: null, shelf: null, quantity: 0, isActive: true } as never)).rejects.toBeInstanceOf(ConflictError);
    await saveBook(adminOf(schoolA), { bookId, title: "Physics Class 9", author: null, isbn: null, category: null, publisher: null, shelf: null, quantity: 1, isActive: true } as never);
    expect((await copiesOf(bookId)).filter((copy) => copy.status !== "WITHDRAWN").map((copy) => copy.code)).toEqual(["BK-0002"]);
  });
});

// -----------------------------------------------------------------------------
// Profile photos
// -----------------------------------------------------------------------------

describe("profile photos for every role", () => {
  const roles = () => [
    ["School Admin", adminOf(schoolA)],
    ["Teacher", teacherOf(schoolA)],
    ["Parent", parentA()],
    ["Student", studentA()],
    ["Librarian", librarian()],
  ] as const;

  it("each uploads, sees it in the header, replaces it, and removes it (initials again)", async () => {
    for (const [, ctx] of roles()) {
      const target = await selfTarget(ctx);
      expect(await selfPhotoUrl(ctx.user)).toBeNull();
      const first = await setPhoto(ctx, target, pngFile(120, 120));
      expect(await selfPhotoUrl(ctx.user)).toBe(first);
      const photoId = first.split("/").pop()!.split("?")[0]!;
      expect((await readPhoto(ctx, photoId)).mimeType).toBe("image/png");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await setPhoto(ctx, target, pngFile(200, 200));
      expect(second).not.toBe(first);
      await removePhoto(ctx, target);
      expect(await selfPhotoUrl(ctx.user)).toBeNull();
    }
  });

  it("refuses tiny images and files that are not images, whatever their name", async () => {
    const ctx = teacherOf(schoolA);
    const target = await selfTarget(ctx);
    await expect(setPhoto(ctx, target, pngFile(10, 10))).rejects.toThrow(/too small/);
    await expect(setPhoto(ctx, target, new File([new Uint8Array(Buffer.from("MZ\x90\x00 not really"))], "photo.png", { type: "image/png" }))).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(setPhoto(ctx, { type: "TEACHER", id: "someone-else" }, pngFile())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps schools apart, and shows parents only their child's teachers", async () => {
    const teacherPhoto = (await setPhoto(teacherOf(schoolA), await selfTarget(teacherOf(schoolA)), pngFile())).split("/").pop()!.split("?")[0]!;
    const staffPhoto = (await setPhoto(librarian(), await selfTarget(librarian()), pngFile())).split("/").pop()!.split("?")[0]!;
    // The child's own teacher: yes. Another school: never. Staff: not for families.
    expect((await readPhoto(parentA(), teacherPhoto)).bytes.length).toBeGreaterThan(0);
    await expect(readPhoto(adminOf(schoolB), teacherPhoto)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readPhoto(contextFor(schoolB, schoolB.parentUserId, "PARENT"), teacherPhoto)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readPhoto(parentA(), staffPhoto)).rejects.toBeInstanceOf(NotFoundError);
    expect((await readPhoto(teacherOf(schoolA), staffPhoto)).bytes.length).toBeGreaterThan(0);

    // A teacher who does not teach the parent's child.
    const user = await prisma.user.create({ data: { email: "unrelated@lib-test.test", passwordHash: "x", role: "TEACHER", firstName: "Un", lastName: "Related", schoolId: schoolA.schoolId, activatedAt: new Date() } });
    await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "UNREL", firstName: "Un", lastName: "Related" } });
    const unrelated = contextFor(schoolA, user.id, "TEACHER");
    const unrelatedPhoto = (await setPhoto(unrelated, await selfTarget(unrelated), pngFile())).split("/").pop()!.split("?")[0]!;
    await expect(readPhoto(parentA(), unrelatedPhoto)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// -----------------------------------------------------------------------------
// Student leave
// -----------------------------------------------------------------------------

describe("student leave", () => {
  let nurseryStudentId: string;
  let nurseryParent: ReturnType<typeof contextFor>;
  let nurseryTeacher: ReturnType<typeof contextFor>;
  const apply = (ctx: ReturnType<typeof contextFor>, overrides: Record<string, unknown>) =>
    applyStudentLeave(ctx, studentLeaveSchema.parse({ fromDate: today().toISOString().slice(0, 10), toDate: today().toISOString().slice(0, 10), reason: "SICK", ...overrides }));

  beforeAll(async () => {
    // A Nursery class with its own class teacher, and a child with a parent login.
    const classId = (await prisma.class.create({ data: { schoolId: schoolA.schoolId, name: "Nursery", level: -3 } })).id;
    const tUser = await prisma.user.create({ data: { email: "nursery.teacher@lib-test.test", passwordHash: "x", role: "TEACHER", firstName: "Asha", lastName: "Nair", schoolId: schoolA.schoolId, activatedAt: new Date() } });
    const teacher = await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: tUser.id, employeeId: "NUR1", firstName: "Asha", lastName: "Nair" } });
    const sectionId = (await prisma.section.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, classId, name: "A", classTeacherId: teacher.id } })).id;
    nurseryStudentId = (await prisma.student.create({ data: { schoolId: schoolA.schoolId, admissionNumber: "NUR-001", firstName: "Tiny", lastName: "Tot" } })).id;
    await prisma.studentEnrollment.create({ data: { schoolId: schoolA.schoolId, studentId: nurseryStudentId, academicSessionId: schoolA.academicSessionId, classId, sectionId } });
    const pUser = await prisma.user.create({ data: { email: "nursery.parent@lib-test.test", passwordHash: "x", role: "PARENT", firstName: "Maa", lastName: "Tot", schoolId: schoolA.schoolId, activatedAt: new Date() } });
    const parent = await prisma.parent.create({ data: { schoolId: schoolA.schoolId, userId: pUser.id, firstName: "Maa", lastName: "Tot", phone: "9000000077" } });
    await prisma.parentStudent.create({ data: { schoolId: schoolA.schoolId, parentId: parent.id, studentId: nurseryStudentId, relationship: "MOTHER" } });
    nurseryParent = contextFor(schoolA, pUser.id, "PARENT");
    nurseryTeacher = contextFor(schoolA, tUser.id, "TEACHER");
  });

  it("a Nursery parent applies; it goes to the Nursery class teacher, who is told", async () => {
    const { id } = await apply(nurseryParent, { studentId: nurseryStudentId, reason: "FAMILY_FUNCTION", note: "Cousin's wedding" });
    const rows = await listStudentLeaves(nurseryTeacher);
    expect(rows.find((row) => row.id === id)).toMatchObject({ status: "PENDING", approver: "Asha Nair", mayDecide: true });
    expect((await getTeacherAlerts(nurseryTeacher)).some((alert) => alert.title === "New leave request submitted for Tiny Tot.")).toBe(true);
    // Class 10's class teacher neither sees nor decides it.
    expect((await listStudentLeaves(teacherOf(schoolA))).map((row) => row.id)).not.toContain(id);
    await expect(decideStudentLeave(teacherOf(schoolA), { leaveId: id, decision: "APPROVE", comment: null })).rejects.toBeInstanceOf(NotFoundError);
    await decideStudentLeave(nurseryTeacher, { leaveId: id, decision: "REJECT", comment: "Please attend the unit test" });
    expect((await getParentAlerts(nurseryParent)).some((alert) => alert.title === "Tiny Tot's leave request has been rejected.")).toBe(true);
  });

  it("a Class 10 parent applies, and so can the student with a login; nobody applies for another's child", async () => {
    const byParent = await apply(parentA(), { studentId: schoolA.studentIds[0], fromDate: addDays(today(), 3).toISOString().slice(0, 10), toDate: addDays(today(), 4).toISOString().slice(0, 10) });
    const byStudent = await apply(studentA(), { reason: "MEDICAL_APPOINTMENT", fromDate: addDays(today(), 10).toISOString().slice(0, 10), toDate: addDays(today(), 10).toISOString().slice(0, 10) });
    const mine = await listStudentLeaves(studentA());
    expect(mine.map((row) => row.id).sort()).toEqual([byParent.id, byStudent.id].sort());
    await expect(apply(parentA(), { studentId: nurseryStudentId })).rejects.toBeInstanceOf(NotFoundError);
    await expect(apply(contextFor(schoolB, schoolB.parentUserId, "PARENT"), { studentId: schoolA.studentIds[0] })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses bad dates, a missing Other reason, overlaps, and leave too far back", async () => {
    expect(() => studentLeaveSchema.parse({ fromDate: "2026-10-05", toDate: "2026-10-04", reason: "SICK" })).toThrow();
    expect(() => studentLeaveSchema.parse({ fromDate: "2026-10-05", toDate: "2026-10-05", reason: "OTHER" })).toThrow();
    await expect(apply(parentA(), { studentId: schoolA.studentIds[0], fromDate: addDays(today(), 4).toISOString().slice(0, 10), toDate: addDays(today(), 6).toISOString().slice(0, 10) })).rejects.toBeInstanceOf(ConflictError);
    await expect(apply(parentA(), { studentId: schoolA.studentIds[0], fromDate: addDays(today(), -30).toISOString().slice(0, 10), toDate: addDays(today(), -29).toISOString().slice(0, 10) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the admin sees every request in the school; another school sees none; history is kept", async () => {
    const all = await listStudentLeaves(adminOf(schoolA));
    expect(all.length).toBe(3);
    expect(all.find((row) => row.status === "REJECTED")).toMatchObject({ approver: "Asha Nair", comment: "Please attend the unit test" });
    expect(all.find((row) => row.status === "REJECTED")!.decidedAt).toBeInstanceOf(Date);
    expect(await listStudentLeaves(adminOf(schoolB))).toEqual([]);
  });

  it("approval shows on the register as On leave, and never overwrites a mark already made", async () => {
    // Today already marked Present for the Class 10 student; then leave for today is approved.
    await prisma.studentAttendance.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, studentId: schoolA.studentIds[1]!, sectionId: schoolA.sectionId, date: today(), status: "PRESENT" } });
    const parentOfSecond = await prisma.parentStudent.findFirst({ where: { studentId: schoolA.studentIds[1] }, select: { parent: { select: { userId: true } } } });
    const asker = parentOfSecond?.parent.userId ? contextFor(schoolA, parentOfSecond.parent.userId, "PARENT") : parentA();
    // The fixture parent may be linked to several children; apply through whoever is linked.
    const { id } = await apply(asker, { studentId: schoolA.studentIds[1] });
    const { markedDays } = await decideStudentLeave(teacherOf(schoolA), { leaveId: id, decision: "APPROVE", comment: null });
    expect(markedDays).toBe(1);
    expect((await prisma.studentAttendance.findFirstOrThrow({ where: { studentId: schoolA.studentIds[1], date: today() } })).status).toBe("PRESENT");
    const register = await getRegister(teacherOf(schoolA), schoolA.sectionId, today());
    expect(register.rows.find((row) => row.studentId === schoolA.studentIds[1])).toMatchObject({ leave: "Sick", status: "PRESENT" });
    expect(register.rows.find((row) => row.studentId === schoolA.studentIds[2])?.leave).toBeNull();
    // Only the admin can overturn it now.
    await expect(decideStudentLeave(teacherOf(schoolA), { leaveId: id, decision: "REJECT", comment: null })).rejects.toBeInstanceOf(ConflictError);
    await decideStudentLeave(adminOf(schoolA), { leaveId: id, decision: "REJECT", comment: "Was present" });
    expect((await listStudentLeaves(adminOf(schoolA))).find((row) => row.id === id)).toMatchObject({ status: "REJECTED", decidedByAdmin: true });
  });

  it("the family can cancel a pending request, not someone else's", async () => {
    const [pending] = await listStudentLeaves(studentA(), { status: "PENDING" });
    await expect(cancelStudentLeave(nurseryParent, pending!.id)).rejects.toBeInstanceOf(NotFoundError);
    await cancelStudentLeave(studentA(), pending!.id);
    expect((await listStudentLeaves(adminOf(schoolA))).find((row) => row.id === pending!.id)?.status).toBe("CANCELLED");
  });
});
