/**
 * The School Admin corrects a mistyped email — for a teacher, parent, staff
 * member or student — and the sign-in address moves with it. Links already
 * sent to the wrong address stop working; a pending login gets a new
 * activation link at the right one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { staffSchema } from "@/lib/validation/operations";
import { createTeacherSchema, updateStudentSchema, updateTeacherSchema } from "@/lib/validation/school";
import { redeemAccountLink } from "@/server/auth/account-links";
import { prisma } from "@/server/db/prisma";
import { grantStaffPortal, saveStaff, saveStaffDetails } from "@/server/operations/staff";
import { updateParent, updateStudent } from "@/server/people/students";
import { createTeacher, updateTeacher } from "@/server/people/teachers";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";
import { sentMail, tokenFrom } from "../helpers/mail";

let schoolA: SeededSchool;
let teacherId: string;

const teacherInput = (email: string) => updateTeacherSchema.parse({ teacherId, firstName: "Typo", lastName: "Teacher", employeeId: "EMAIL-T", email });

beforeAll(async () => {
  ({ schoolA } = await createIsolationFixture());
  teacherId = (await createTeacher(adminOf(schoolA), createTeacherSchema.parse({ firstName: "Typo", lastName: "Teacher", employeeId: "EMAIL-T", email: "tpyo@email-test.test" }))).teacherId;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("correcting a mistyped email", () => {
  it("teacher (not yet activated): the login moves, the old link dies, a new link goes to the right address", async () => {
    const oldToken = tokenFrom("tpyo@email-test.test", "activate");
    const move = await updateTeacher(adminOf(schoolA), teacherInput("typo@email-test.test"));
    expect(move).toMatchObject({ from: "tpyo@email-test.test", to: "typo@email-test.test", invite: { delivered: true } });
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, select: { email: true, user: { select: { email: true } } } });
    expect(teacher).toEqual({ email: "typo@email-test.test", user: { email: "typo@email-test.test" } });
    // Whoever owns the wrong address cannot use what was sent there.
    await expect(redeemAccountLink(oldToken, "ACTIVATION", "Password-123", "Password-123")).rejects.toBeInstanceOf(ValidationError);
    // The right person can.
    expect(sentMail.some((mail) => mail.to === "typo@email-test.test")).toBe(true);
    await redeemAccountLink(tokenFrom("typo@email-test.test", "activate"), "ACTIVATION", "Password-123", "Password-123");
    expect(await prisma.auditLog.count({ where: { action: "LOGIN_EMAIL_CHANGED", schoolId: schoolA.schoolId } })).toBe(1);
  });

  it("refuses an address another account already uses — and changes nothing", async () => {
    const taken = (await prisma.user.findUniqueOrThrow({ where: { id: schoolA.parentUserId } })).email;
    await expect(updateTeacher(adminOf(schoolA), teacherInput(taken))).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } })).email).toBe("typo@email-test.test");
  });

  it("parent: the sign-in address moves with the record; it cannot be emptied while they have a login", async () => {
    const parent = await prisma.parent.findFirstOrThrow({ where: { userId: schoolA.parentUserId } });
    const base = { parentId: parent.id, firstName: parent.firstName, lastName: parent.lastName, phone: parent.phone, occupation: null, addressLine: null };
    const move = await updateParent(adminOf(schoolA), { ...base, email: "Parent.Fixed@email-test.test" });
    expect(move?.to).toBe("parent.fixed@email-test.test");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: schoolA.parentUserId } })).email).toBe("parent.fixed@email-test.test");
    await expect(updateParent(adminOf(schoolA), { ...base, email: null })).rejects.toBeInstanceOf(ValidationError);
  });

  it("staff member with a login", async () => {
    const staffId = await saveStaff(adminOf(schoolA), staffSchema.parse({ employeeId: "EMAIL-S", firstName: "Office", lastName: "Staff", role: "OFFICE_STAFF", email: "ofice@email-test.test" }));
    await grantStaffPortal(adminOf(schoolA), staffId, "ofice@email-test.test");
    const { emailMove } = await saveStaffDetails(adminOf(schoolA), staffSchema.parse({ staffId, employeeId: "EMAIL-S", firstName: "Office", lastName: "Staff", role: "OFFICE_STAFF", email: "office@email-test.test" }));
    expect(emailMove).toMatchObject({ to: "office@email-test.test", invite: { delivered: true } });
    const staff = await prisma.staffMember.findUniqueOrThrow({ where: { id: staffId }, select: { email: true, user: { select: { email: true } } } });
    expect(staff).toEqual({ email: "office@email-test.test", user: { email: "office@email-test.test" } });
  });

  it("student (Class 6–12) with a login; Nursery–5 have no email", async () => {
    const student = await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[0] } });
    const input = (email: string) =>
      updateStudentSchema.parse({ studentId: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber, email });
    const move = await updateStudent(adminOf(schoolA), input("student.fixed@email-test.test"));
    expect(move?.to).toBe("student.fixed@email-test.test");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: schoolA.studentUserId } })).email).toBe("student.fixed@email-test.test");
    expect((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).email).toBe("student.fixed@email-test.test");
    await expect(updateStudent(adminOf(schoolA), input(""))).rejects.toBeInstanceOf(ValidationError);

    // A Nursery child: no email at all.
    const klass = await prisma.class.create({ data: { schoolId: schoolA.schoolId, name: "UKG", level: -1 } });
    const section = await prisma.section.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, classId: klass.id, name: "A" } });
    const little = await prisma.student.create({ data: { schoolId: schoolA.schoolId, admissionNumber: "UKG-1", firstName: "Little", lastName: "One" } });
    await prisma.studentEnrollment.create({ data: { schoolId: schoolA.schoolId, studentId: little.id, academicSessionId: schoolA.academicSessionId, classId: klass.id, sectionId: section.id } });
    await expect(
      updateStudent(adminOf(schoolA), updateStudentSchema.parse({ studentId: little.id, firstName: "Little", lastName: "One", admissionNumber: "UKG-1", email: "little@email-test.test" })),
    ).rejects.toBeInstanceOf(ValidationError);
    // Saving other details without an email field leaves email untouched.
    expect(await updateStudent(adminOf(schoolA), updateStudentSchema.parse({ studentId: little.id, firstName: "Little", lastName: "Two", admissionNumber: "UKG-1" }))).toBeNull();
  });

  it("only the School Admin corrects emails", async () => {
    await expect(updateTeacher(teacherOf(schoolA), teacherInput("x@email-test.test"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateTeacher(contextFor(schoolA, schoolA.parentUserId, "PARENT"), teacherInput("x@email-test.test"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
