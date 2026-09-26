/**
 * Academic structure and people management by the School Admin.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createStudentSchema } from "@/lib/validation/school";
import { authenticate } from "@/server/auth/login";
import { canAccessSection } from "@/server/auth/teacher-access";
import { prisma } from "@/server/db/prisma";
import {
  createAcademicSession,
  createSection,
  setCurrentSession,
} from "@/server/academics/structure";
import {
  createStudent,
  deleteStudent,
  enrollStudent,
  grantParentPortal,
  linkGuardian,
} from "@/server/people/students";
import {
  assignSubject,
  createTeacher,
  deleteTeacher,
  updateTeacher,
} from "@/server/people/teachers";

import { adminOf, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

let guardianSeq = 0;

/**
 * A student always arrives with somebody responsible for them, so the helper
 * supplies a fresh guardian unless a test names an existing one.
 */
function studentInput(overrides: Record<string, string>) {
  guardianSeq += 1;
  return createStudentSchema.parse({
    firstName: "New",
    lastName: "Student",
    guardianMode: "new",
    parentFirstName: "Helper",
    parentLastName: `Guardian${guardianSeq}`,
    parentPhone: `+91 90000 0${String(1000 + guardianSeq).slice(-4)}`,
    relationship: "FATHER",
    ...overrides,
  });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.user.deleteMany({ where: { email: { endsWith: "@people-test.test" } } });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@people-test.test" } } });
  await prisma.$disconnect();
});

describe("students", () => {
  it("admits a student with an enrollment, a new guardian and an automatic admission number", async () => {
    const ctx = adminOf(schoolA);
    const id = await createStudent(
      ctx,
      studentInput({
        sectionId: schoolA.sectionId,
        guardianMode: "new",
        parentFirstName: "Meena",
        parentLastName: "Rao",
        parentPhone: "+91 90000 11111",
        relationship: "MOTHER",
      }),
    );

    const student = await prisma.student.findUniqueOrThrow({
      where: { id },
      include: { enrollments: true, parents: { include: { parent: true } } },
    });
    expect(student.schoolId).toBe(schoolA.schoolId);
    expect(student.admissionNumber).toMatch(/^ADM\d{4}$/);
    expect(student.enrollments).toHaveLength(1);
    expect(student.enrollments[0]?.classId).toBe(schoolA.classId);
    expect(student.parents[0]?.parent.firstName).toBe("Meena");
    expect(student.parents[0]?.isPrimary).toBe(true);
  });

  it("refuses to place a student in another school's section", async () => {
    await expect(
      createStudent(adminOf(schoolA), studentInput({ sectionId: schoolB.sectionId })),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await prisma.student.count({ where: { schoolId: schoolB.schoolId } })).toBe(
      schoolB.studentIds.length,
    );
  });

  it("refuses to link another school's guardian", async () => {
    await expect(
      linkGuardian(adminOf(schoolA), {
        studentId: schoolA.studentIds[0]!,
        guardianMode: "existing",
        existingParentId: schoolB.parentId,
        parentFirstName: null,
        parentLastName: null,
        parentPhone: null,
        parentEmail: null,
        occupation: null,
        relationship: "GUARDIAN",
        isPrimary: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a duplicate roll number in the same section", async () => {
    const ctx = adminOf(schoolA);
    await expect(
      createStudent(ctx, studentInput({ sectionId: schoolA.sectionId, rollNumber: "1" })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("is not available to teachers", async () => {
    await expect(
      createStudent(teacherOf(schoolA), studentInput({ sectionId: schoolA.sectionId })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("promotes into a new session without touching last year's placement", async () => {
    const ctx = adminOf(schoolA);
    await createAcademicSession(ctx, {
      name: "2027-28",
      startDate: new Date(Date.UTC(2027, 3, 1)),
      endDate: new Date(Date.UTC(2028, 2, 31)),
      makeCurrent: false,
    });
    const next = await prisma.academicSession.findFirstOrThrow({
      where: { schoolId: schoolA.schoolId, name: "2027-28" },
    });
    const sectionId = await createSection(ctx, {
      academicSessionId: next.id,
      classId: schoolA.classId,
      name: "a",
      streamId: null,
      capacity: 40,
      classTeacherId: null,
    });

    const studentId = schoolA.studentIds[0]!;
    await enrollStudent(ctx, { studentId, academicSessionId: next.id, sectionId, rollNumber: "7" });

    const enrollments = await prisma.studentEnrollment.findMany({ where: { studentId } });
    expect(enrollments).toHaveLength(2);
    expect(enrollments.find((e) => e.academicSessionId === schoolA.academicSessionId)?.sectionId).toBe(
      schoolA.sectionId,
    );
  });

  it("keeps exactly one current session, and only within the school", async () => {
    const ctx = adminOf(schoolA);
    const next = await prisma.academicSession.findFirstOrThrow({
      where: { schoolId: schoolA.schoolId, name: "2027-28" },
    });
    await setCurrentSession(ctx, next.id);

    const current = await prisma.academicSession.findMany({
      where: { schoolId: schoolA.schoolId, isCurrent: true },
    });
    expect(current.map((s) => s.id)).toEqual([next.id]);
    expect(
      await prisma.academicSession.count({ where: { schoolId: schoolB.schoolId, isCurrent: true } }),
    ).toBe(1);

    await setCurrentSession(ctx, schoolA.academicSessionId);
  });

  it("issues a working guardian login once", async () => {
    const ctx = adminOf(schoolB);
    const parent = await prisma.parent.create({
      data: { schoolId: schoolB.schoolId, firstName: "Login", lastName: "Parent", phone: "+91 90000 22222" },
    });
    const credentials = await grantParentPortal(ctx, parent.id, "guardian@people-test.test");
    expect((await authenticate(credentials.email, credentials.password)).ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "guardian@people-test.test" } });
    expect(user.role).toBe("PARENT");
    expect(user.schoolId).toBe(schoolB.schoolId);

    await expect(grantParentPortal(ctx, parent.id, "other@people-test.test")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("teachers", () => {
  it("creates the staff record and a TEACHER login together", async () => {
    const { teacherId, credentials } = await createTeacher(adminOf(schoolB), {
      firstName: "Nita",
      lastName: "Das",
      email: "nita@people-test.test",
      gender: null,
      employeeId: null,
      phone: null,
      qualification: null,
      designation: null,
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
    });

    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, include: { user: true } });
    expect(teacher.user.role).toBe("TEACHER");
    expect(teacher.schoolId).toBe(schoolB.schoolId);
    expect((await authenticate(credentials.email, credentials.password)).ok).toBe(true);

    await expect(
      createTeacher(adminOf(schoolA), {
        firstName: "Dup",
        lastName: "Licate",
        email: "nita@people-test.test",
        gender: null,
        employeeId: null,
        phone: null,
        qualification: null,
        designation: null,
        dateOfBirth: null,
        addressLine: null,
        city: null,
        state: null,
        postalCode: null,
        joiningDate: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("grants section access through a subject assignment", async () => {
    const admin = adminOf(schoolA);
    const teacher = teacherOf(schoolA);
    expect(await canAccessSection(teacher, schoolA.unassignedSectionId)).toBe(false);

    await assignSubject(admin, {
      teacherId: schoolA.teacherId,
      subjectId: schoolA.subjectId,
      sectionId: schoolA.unassignedSectionId,
    });
    expect(await canAccessSection(teacher, schoolA.unassignedSectionId)).toBe(true);

    await expect(
      assignSubject(admin, { teacherId: schoolA.teacherId, subjectId: schoolA.subjectId, sectionId: schoolB.sectionId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("disables the login of a teacher who leaves", async () => {
    const { teacherId, credentials } = await createTeacher(adminOf(schoolA), {
      firstName: "Leaving",
      lastName: "Soon",
      email: "leaving@people-test.test",
      gender: null,
      employeeId: null,
      phone: null,
      qualification: null,
      designation: null,
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
    });

    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });
    await updateTeacher(adminOf(schoolA), {
      teacherId,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: credentials.email,
      gender: null,
      employeeId: teacher.employeeId,
      phone: null,
      qualification: null,
      designation: null,
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
      status: "INACTIVE",
    });

    expect((await authenticate(credentials.email, credentials.password)).ok).toBe(false);
  });

  it("moves the sign-in address when the admin corrects it", async () => {
    const { teacherId, credentials } = await createTeacher(adminOf(schoolA), {
      firstName: "Typo",
      lastName: "Address",
      email: "tpyo@people-test.test",
      gender: null,
      employeeId: null,
      phone: null,
      qualification: null,
      designation: null,
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
    });

    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });
    await updateTeacher(adminOf(schoolA), {
      teacherId,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: "typo@people-test.test",
      gender: null,
      employeeId: teacher.employeeId,
      phone: null,
      qualification: null,
      designation: null,
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
      status: "ACTIVE",
    });

    // The password is untouched, so the old address simply stops working and
    // the new one starts.
    expect((await authenticate("tpyo@people-test.test", credentials.password)).ok).toBe(false);
    expect((await authenticate("typo@people-test.test", credentials.password)).ok).toBe(true);
    // Both copies moved: the staff record's own address and the login's.
    await expect(
      prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, select: { email: true } }),
    ).resolves.toEqual({ email: "typo@people-test.test" });
  });

  it("refuses an address another account already uses", async () => {
    const { teacherId } = await createTeacher(adminOf(schoolA), {
      firstName: "Wants",
      lastName: "Taken",
      email: "wants.taken@people-test.test",
      gender: null,
      employeeId: null,
      phone: null,
      qualification: null,
      designation: null,
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
    });
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });

    await expect(
      updateTeacher(adminOf(schoolA), {
        teacherId,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        // Already the corrected teacher's address, from the test above.
        email: "typo@people-test.test",
        gender: null,
        employeeId: teacher.employeeId,
        phone: null,
        qualification: null,
        designation: null,
        dateOfBirth: null,
        addressLine: null,
        city: null,
        state: null,
        postalCode: null,
        joiningDate: null,
        status: "ACTIVE",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("deleting a student", () => {
  async function freshStudent(suffix: string) {
    return createStudent(
      adminOf(schoolA),
      studentInput({ firstName: "Typed", lastName: `ByMistake${suffix}`, sectionId: schoolA.sectionId }),
    );
  }

  it("erases the student, their placement, their parent links and their login", async () => {
    const studentId = await freshStudent("A");
    await linkGuardian(adminOf(schoolA), {
      studentId,
      guardianMode: "existing",
      existingParentId: schoolA.parentId,
      parentFirstName: null,
      parentLastName: null,
      parentPhone: null,
      parentEmail: null,
      occupation: null,
      relationship: "FATHER",
      isPrimary: false,
    });

    await deleteStudent(adminOf(schoolA), studentId);

    await expect(prisma.student.findUnique({ where: { id: studentId } })).resolves.toBeNull();
    await expect(prisma.studentEnrollment.count({ where: { studentId } })).resolves.toBe(0);
    await expect(prisma.parentStudent.count({ where: { studentId } })).resolves.toBe(0);
    // The guardian is a person of their own and keeps their other children.
    await expect(prisma.parent.findUnique({ where: { id: schoolA.parentId } })).resolves.not.toBeNull();
  });

  it("refuses to erase a child who is already in a register", async () => {
    const studentId = await freshStudent("B");
    await prisma.studentAttendance.create({
      data: {
        schoolId: schoolA.schoolId,
        academicSessionId: schoolA.academicSessionId,
        studentId,
        sectionId: schoolA.sectionId,
        date: new Date(Date.UTC(2026, 8, 2)),
        status: "PRESENT",
      },
    });

    await expect(deleteStudent(adminOf(schoolA), studentId)).rejects.toBeInstanceOf(ConflictError);
    await expect(prisma.student.findUnique({ where: { id: studentId } })).resolves.not.toBeNull();
  });

  it("hides a student in another school behind a missing row", async () => {
    await expect(deleteStudent(adminOf(schoolA), schoolB.studentIds[0]!)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      prisma.student.findUnique({ where: { id: schoolB.studentIds[0]! } }),
    ).resolves.not.toBeNull();
  });

  it("is closed to a teacher", async () => {
    await expect(deleteStudent(teacherOf(schoolA), schoolA.studentIds[0]!)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("deleting a teacher", () => {
  /** A teacher with nothing attached, as an admin who mistyped would have. */
  async function freshTeacher(suffix: string) {
    return createTeacher(adminOf(schoolA), {
      firstName: "Added",
      lastName: "ByMistake",
      email: `mistake-${suffix}@people-test.test`,
      gender: null,
      employeeId: null,
      phone: null,
      qualification: null,
      designation: null,
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
    });
  }

  it("erases the staff record, the login and the subject assignments together", async () => {
    const { teacherId, credentials } = await freshTeacher("clean");
    const user = await prisma.teacher.findUniqueOrThrow({
      where: { id: teacherId },
      select: { userId: true },
    });
    await assignSubject(adminOf(schoolA), {
      teacherId,
      subjectId: schoolA.subjectId,
      sectionId: schoolA.sectionId,
    });

    await deleteTeacher(adminOf(schoolA), teacherId);

    await expect(prisma.teacher.findUnique({ where: { id: teacherId } })).resolves.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: user.userId } })).resolves.toBeNull();
    // An assignment is a permission, not a record, so it goes with them.
    await expect(
      prisma.teacherSubjectAssignment.count({ where: { teacherId } }),
    ).resolves.toBe(0);
    expect((await authenticate(credentials.email, credentials.password)).ok).toBe(false);
  });

  it("refuses to erase a teacher who has a record in the school", async () => {
    const { teacherId } = await freshTeacher("history");
    await prisma.homework.create({
      data: {
        schoolId: schoolA.schoolId,
        academicSessionId: schoolA.academicSessionId,
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        teacherId,
        title: "Something they set",
        assignedOn: new Date(Date.UTC(2026, 8, 1)),
        dueOn: new Date(Date.UTC(2026, 8, 2)),
      },
    });

    await expect(deleteTeacher(adminOf(schoolA), teacherId)).rejects.toBeInstanceOf(ConflictError);
    // Still there, and still able to be deactivated instead.
    await expect(prisma.teacher.findUnique({ where: { id: teacherId } })).resolves.not.toBeNull();
  });

  it("refuses while a live responsibility is still theirs", async () => {
    const { teacherId } = await freshTeacher("live");
    const section = await prisma.section.create({
      data: {
        schoolId: schoolA.schoolId,
        academicSessionId: schoolA.academicSessionId,
        classId: schoolA.classId,
        name: "DEL",
        classTeacherId: teacherId,
      },
    });

    await expect(deleteTeacher(adminOf(schoolA), teacherId)).rejects.toBeInstanceOf(ConflictError);

    // Handed over, and the same delete now goes through.
    await prisma.section.update({ where: { id: section.id }, data: { classTeacherId: null } });
    await deleteTeacher(adminOf(schoolA), teacherId);
    await expect(prisma.teacher.findUnique({ where: { id: teacherId } })).resolves.toBeNull();
  });

  it("hides a teacher in another school behind a missing row", async () => {
    await expect(deleteTeacher(adminOf(schoolA), schoolB.teacherId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      prisma.teacher.findUnique({ where: { id: schoolB.teacherId } }),
    ).resolves.not.toBeNull();
  });

  it("is closed to a teacher, who cannot delete themselves or a colleague", async () => {
    await expect(deleteTeacher(teacherOf(schoolA), schoolA.teacherId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("plan limits", () => {
  it("blocks adding a student beyond the plan's allowance", async () => {
    const plan = await prisma.plan.upsert({
      where: { tier: "STARTER" },
      update: {},
      create: { tier: "STARTER", name: "Starter", priceMinor: 1500000 },
    });
    const original = plan.maxStudents;
    const active = await prisma.student.count({ where: { schoolId: schoolB.schoolId, status: "ACTIVE" } });
    await prisma.plan.update({ where: { id: plan.id }, data: { maxStudents: active } });
    const subscription = await prisma.subscription.create({
      data: { schoolId: schoolB.schoolId, planId: plan.id, status: "ACTIVE", startsAt: new Date() },
    });

    try {
      await expect(
        createStudent(adminOf(schoolB), studentInput({ sectionId: schoolB.sectionId })),
      ).rejects.toThrow(/allows up to/);
    } finally {
      await prisma.subscription.delete({ where: { id: subscription.id } });
      await prisma.plan.update({ where: { id: plan.id }, data: { maxStudents: original } });
    }
  });
});
