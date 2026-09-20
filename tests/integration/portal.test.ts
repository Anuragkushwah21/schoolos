/**
 * What each person sees of themselves — and, more importantly, what they do
 * not. A guardian in the right school is still not entitled to another
 * family's child.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { getParentChildren, getTeacherDay, requireChildOfParent } from "@/server/people/portal";

import { contextFor, teacherOf } from "../helpers/context";
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
});
