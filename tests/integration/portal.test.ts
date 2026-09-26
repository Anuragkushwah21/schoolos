/**
 * What each person sees of themselves — and, more importantly, what they do
 * not. A guardian in the right school is still not entitled to another
 * family's child.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { today } from "@/lib/dates";
import { prisma } from "@/server/db/prisma";
import { getParentChildren, getTeacherDay, requireChildOfParent } from "@/server/people/portal";
import { markAttendance } from "@/server/attendance/service";
import { addRemark } from "@/server/classwork/remarks";
import { createStudent, grantParentPortal } from "@/server/people/students";
import { createTeacher } from "@/server/people/teachers";
import { getMyProfile } from "@/server/people/teacher-self";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("parent portal", () => {
  it("lists exactly the children linked to the signed-in guardian", async () => {
    const { children } = await getParentChildren(parentOf(schoolA));
    expect(children.map((child) => child.id).sort()).toEqual([...schoolA.studentIds].sort());
  });

  it("refuses a child of another guardian in the same school", async () => {
    const otherParent = await prisma.parent.create({
      data: { schoolId: schoolA.schoolId, firstName: "Other", lastName: "Guardian", phone: "+91 98888 00000" },
    });
    const otherChild = await prisma.student.create({
      data: { schoolId: schoolA.schoolId, admissionNumber: "ADM9001", firstName: "Not", lastName: "Yours" },
    });
    await prisma.parentStudent.create({
      data: {
        schoolId: schoolA.schoolId,
        parentId: otherParent.id,
        studentId: otherChild.id,
        relationship: "GUARDIAN",
      },
    });

    await expect(requireChildOfParent(parentOf(schoolA), otherChild.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requireChildOfParent(parentOf(schoolA), schoolA.studentIds[0]!)).resolves.toMatchObject({
      id: schoolA.studentIds[0],
    });
  });

  it("refuses a child in another school", async () => {
    await expect(requireChildOfParent(parentOf(schoolA), schoolB.studentIds[0]!)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("gives one login every child linked to it, not one login per child", async () => {
    // The fixture links all of school A's children to one parent row, which is
    // the point: siblings share a guardian, and a guardian signs in once.
    const { children } = await getParentChildren(parentOf(schoolA));
    expect(children.length).toBeGreaterThan(1);

    const logins = await prisma.user.count({
      where: { schoolId: schoolA.schoolId, role: "PARENT" },
    });
    expect(logins).toBe(1);

    // And every one of those children resolves through the same session.
    for (const child of children) {
      await expect(requireChildOfParent(parentOf(schoolA), child.id)).resolves.toMatchObject({
        id: child.id,
      });
    }
  });

  it("refuses a second login for a guardian who already has one", async () => {
    await expect(
      grantParentPortal(adminOf(schoolA), schoolA.parentId, "again@portal-test.test"),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot write anything a school owns", async () => {
    const parent = parentOf(schoolA);
    const child = schoolA.studentIds[0]!;

    // A parent is a reader. Each of these is a different door into the school's
    // own records, and every one of them must be shut by role, not by the UI.
    await expect(
      markAttendance(parent, {
        sectionId: schoolA.sectionId,
        date: today(),
        entries: [{ studentId: child, status: "PRESENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      addRemark(parent, {
        studentId: child,
        subjectId: null,
        understanding: "GOOD",
        homeworkHabit: null,
        participation: null,
        note: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      // The role check fires before the input is even looked at, which is why
      // this deliberately incomplete input still proves what it needs to.
      createStudent(parent, {
        firstName: "Not",
        lastName: "Allowed",
        guardianMode: "new",
      } as unknown as Parameters<typeof createStudent>[1]),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      createTeacher(parent, {
        firstName: "Not",
        lastName: "Allowed",
        email: "nope@portal-test.test",
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
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      grantParentPortal(parent, schoolA.parentId, "self@portal-test.test"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is closed to other roles entirely", async () => {
    await expect(getParentChildren(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireChildOfParent(teacherOf(schoolA), schoolA.studentIds[0]!)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("teacher portal", () => {
  it("shows a teacher only their own sections", async () => {
    const day = await getTeacherDay(teacherOf(schoolA));
    expect(day).not.toBeNull();
    expect(day!.sections.map((section) => section.id)).toEqual([schoolA.sectionId]);
    expect(day!.sections.map((section) => section.id)).not.toContain(schoolA.unassignedSectionId);
  });

  it("shows a teacher their own record even before the school opens a year", async () => {
    const withSession = await getMyProfile(teacherOf(schoolA));
    expect(withSession?.assignments).toHaveLength(1);

    await prisma.academicSession.update({
      where: { id: schoolA.academicSessionId },
      data: { isCurrent: false },
    });

    try {
      // Who somebody is does not depend on the office having opened a year.
      const profile = await getMyProfile(teacherOf(schoolA));
      expect(profile?.teacher.employeeId).toBe("EMP001");
      expect(profile?.session).toBeNull();
      // Only the session-scoped parts empty out.
      expect(profile?.assignments).toEqual([]);
      expect(profile?.classTeacherOf).toEqual([]);
    } finally {
      await prisma.academicSession.update({
        where: { id: schoolA.academicSessionId },
        data: { isCurrent: true },
      });
    }
  });
});
