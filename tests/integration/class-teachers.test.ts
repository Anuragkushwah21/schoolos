/**
 * Class teacher assignment: one per section, any active teacher of the same
 * school, changeable and removable, with history — and separate from subject
 * teaching.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { classTeacherSchema } from "@/lib/validation/school";
import { createApiToken } from "@/server/auth/api-token";
import { prisma } from "@/server/db/prisma";
import { classTeacherHistory, listSections, setClassTeacher } from "@/server/academics/structure";
import { getTeacherProfile } from "@/server/people/teachers";
import { DELETE as removeRoute, PUT as putRoute } from "@/app/api/v1/sections/[sectionId]/class-teacher/route";

import { apiRequest, callApi } from "../helpers/api";
import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let secondTeacherId: string;
let inactiveTeacherId: string;
let tokenA = "";

const sectionOf = async (sectionId: string) =>
  prisma.section.findUniqueOrThrow({ where: { id: sectionId }, select: { classTeacherId: true } });

async function makeTeacher(school: SeededSchool, key: string, status: "ACTIVE" | "INACTIVE") {
  const user = await prisma.user.create({
    data: { email: `${key}@ct-test.test`, passwordHash: "x", role: "TEACHER", firstName: key, lastName: "Teacher", schoolId: school.schoolId },
  });
  const teacher = await prisma.teacher.create({
    data: { schoolId: school.schoolId, userId: user.id, employeeId: key, firstName: key, lastName: "Teacher", status },
  });
  return teacher.id;
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  secondTeacherId = await makeTeacher(schoolA, "ct-second", "ACTIVE");
  inactiveTeacherId = await makeTeacher(schoolA, "ct-inactive", "INACTIVE");
  tokenA = (await createApiToken(adminOf(schoolA).user, { name: "ct", scope: "FULL", expiresAt: null })).token;
  // Start from a known state: nobody leads either of school A's sections.
  await prisma.section.updateMany({ where: { schoolId: schoolA.schoolId }, data: { classTeacherId: null } });
  await prisma.classTeacherAssignment.deleteMany({ where: { schoolId: schoolA.schoolId } });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@ct-test.test" } } });
  await prisma.$disconnect();
});

describe("assigning a class teacher", () => {
  it("assigns, changes and removes, keeping the history", async () => {
    const ctx = adminOf(schoolA);
    await setClassTeacher(ctx, { sectionId: schoolA.sectionId, teacherId: schoolA.teacherId });
    expect((await sectionOf(schoolA.sectionId)).classTeacherId).toBe(schoolA.teacherId);

    await setClassTeacher(ctx, { sectionId: schoolA.sectionId, teacherId: secondTeacherId });
    expect((await sectionOf(schoolA.sectionId)).classTeacherId).toBe(secondTeacherId);

    const { changed } = await setClassTeacher(ctx, { sectionId: schoolA.sectionId, teacherId: null });
    expect(changed).toBe(true);
    expect((await sectionOf(schoolA.sectionId)).classTeacherId).toBeNull();

    const history = await classTeacherHistory(ctx, schoolA.sectionId);
    expect(history.map((row) => [row.teacherId, row.current])).toEqual([
      [secondTeacherId, false],
      [schoolA.teacherId, false],
    ]);
  });

  it("refuses assigning the teacher who already holds it, rather than duplicating", async () => {
    const ctx = adminOf(schoolA);
    await setClassTeacher(ctx, { sectionId: schoolA.sectionId, teacherId: schoolA.teacherId });
    await expect(
      setClassTeacher(ctx, { sectionId: schoolA.sectionId, teacherId: schoolA.teacherId }),
    ).rejects.toBeInstanceOf(ConflictError);
    const open = await prisma.classTeacherAssignment.count({ where: { sectionId: schoolA.sectionId, toDate: null } });
    expect(open).toBe(1);
  });

  it("lets one teacher lead several sections", async () => {
    await setClassTeacher(adminOf(schoolA), { sectionId: schoolA.unassignedSectionId, teacherId: schoolA.teacherId });
    const led = await prisma.section.count({ where: { classTeacherId: schoolA.teacherId } });
    expect(led).toBe(2);
  });

  it("shows on the teacher's profile, apart from their subject assignments", async () => {
    const { teacher } = await getTeacherProfile(adminOf(schoolA), schoolA.teacherId);
    expect(teacher.classTeacherOf.map((section) => section.id).sort()).toEqual(
      [schoolA.sectionId, schoolA.unassignedSectionId].sort(),
    );
    // The subject assignment from the fixture is still there, unchanged.
    expect(teacher.assignments.map((row) => row.section.id)).toEqual([schoolA.sectionId]);
  });

  it("the section list shows who leads each section", async () => {
    const sections = await listSections(adminOf(schoolA), schoolA.academicSessionId);
    expect(sections.every((section) => section.classTeacher?.id === schoolA.teacherId)).toBe(true);
  });

  it("refuses an inactive teacher", async () => {
    await expect(
      setClassTeacher(adminOf(schoolA), { sectionId: schoolA.sectionId, teacherId: inactiveTeacherId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("security", () => {
  it("refuses another school's teacher or section", async () => {
    await expect(
      setClassTeacher(adminOf(schoolA), { sectionId: schoolA.sectionId, teacherId: schoolB.teacherId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setClassTeacher(adminOf(schoolA), { sectionId: schoolB.sectionId, teacherId: schoolA.teacherId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await sectionOf(schoolB.sectionId)).classTeacherId).not.toBe(schoolA.teacherId);
  });

  it("is School Admin only", async () => {
    await expect(
      setClassTeacher(teacherOf(schoolA), { sectionId: schoolA.sectionId, teacherId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setClassTeacher(contextFor(schoolA, schoolA.parentUserId, "PARENT"), { sectionId: schoolA.sectionId, teacherId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the form's empty choice and the API's null both mean remove", () => {
    expect(classTeacherSchema.parse({ sectionId: "s", teacherId: "" }).teacherId).toBeNull();
    expect(classTeacherSchema.parse({ sectionId: "s", teacherId: null }).teacherId).toBeNull();
  });
});

describe("the API", () => {
  it("changes and removes through PUT and DELETE, ignoring a forged schoolId", async () => {
    const url = `/api/v1/sections/${schoolA.sectionId}/class-teacher`;
    const params = { sectionId: schoolA.sectionId };

    const put = await callApi(putRoute, apiRequest(url, { method: "PUT", token: tokenA, body: { teacherId: secondTeacherId, schoolId: schoolB.schoolId } }), params);
    expect(put.status).toBe(200);
    expect((await sectionOf(schoolA.sectionId)).classTeacherId).toBe(secondTeacherId);

    const removed = await callApi(removeRoute, apiRequest(url, { method: "DELETE", token: tokenA }), params);
    expect(removed.status).toBe(200);
    expect((await sectionOf(schoolA.sectionId)).classTeacherId).toBeNull();
  });

  it("answers 404 for another school's section or teacher", async () => {
    const foreign = await callApi(
      putRoute,
      apiRequest(`/api/v1/sections/${schoolB.sectionId}/class-teacher`, { method: "PUT", token: tokenA, body: { teacherId: schoolA.teacherId } }),
      { sectionId: schoolB.sectionId },
    );
    expect(foreign.status).toBe(404);

    const foreignTeacher = await callApi(
      putRoute,
      apiRequest(`/api/v1/sections/${schoolA.sectionId}/class-teacher`, { method: "PUT", token: tokenA, body: { teacherId: schoolB.teacherId } }),
      { sectionId: schoolA.sectionId },
    );
    expect(foreignTeacher.status).toBe(404);
  });
});
