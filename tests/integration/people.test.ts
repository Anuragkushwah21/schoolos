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
import { createStudent, enrollStudent, grantParentPortal, linkGuardian } from "@/server/people/students";
import { assignSubject, createTeacher, updateTeacher } from "@/server/people/teachers";

import { adminOf, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

function studentInput(overrides: Record<string, string>) {
  return createStudentSchema.parse({
    firstName: "New",
    lastName: "Student",
    guardianMode: "none",
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
      joiningDate: null,
    });

    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });
    await updateTeacher(adminOf(schoolA), {
      teacherId,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      gender: null,
      employeeId: teacher.employeeId,
      phone: null,
      qualification: null,
      joiningDate: null,
      status: "INACTIVE",
    });

    expect((await authenticate(credentials.email, credentials.password)).ok).toBe(false);
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
