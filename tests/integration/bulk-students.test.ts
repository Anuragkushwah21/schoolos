/**
 * Bulk student operations: promotion, section change, status, CSV import.
 *
 *   * Promotion adds a placement in the later session and closes the old one;
 *     last session's rows (attendance, marks) are never rewritten.
 *   * Every batch is all-or-nothing, re-checked on the server.
 *   * A CSV import with any bad row writes nothing and reports every row.
 *   * A guardian already on file (same phone) is linked, not duplicated.
 *   * Nothing reaches another school.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { changeSection, importStudents, promoteStudents, setStudentsStatus } from "@/server/people/bulk-students";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let nextSessionId: string;
let nextSectionId: string;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const next = await prisma.academicSession.create({
    data: {
      schoolId: schoolA.schoolId,
      name: "2027-28",
      startDate: new Date(Date.UTC(2027, 3, 1)),
      endDate: new Date(Date.UTC(2028, 2, 31)),
    },
  });
  nextSessionId = next.id;
  const klass = await prisma.class.create({ data: { schoolId: schoolA.schoolId, name: "Class 11", level: 11 } });
  nextSectionId = (
    await prisma.section.create({
      data: { schoolId: schoolA.schoolId, academicSessionId: next.id, classId: klass.id, name: "A" },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("promotion", () => {
  it("places students in the later session and closes, not rewrites, this year's placement", async () => {
    const promoting = schoolA.studentIds.slice(0, 2);
    const attendanceBefore = await prisma.studentAttendance.count({ where: { studentId: { in: promoting } } });

    const { promoted } = await promoteStudents(adminOf(schoolA), {
      fromSessionId: schoolA.academicSessionId,
      toSectionId: nextSectionId,
      studentIds: promoting,
    });
    expect(promoted).toBe(2);

    const rows = await prisma.studentEnrollment.findMany({
      where: { studentId: { in: promoting } },
      select: { academicSessionId: true, status: true, sectionId: true },
    });
    expect(rows.filter((row) => row.academicSessionId === nextSessionId && row.status === "ACTIVE")).toHaveLength(2);
    expect(rows.filter((row) => row.academicSessionId === schoolA.academicSessionId && row.status === "COMPLETED")).toHaveLength(2);
    expect(rows.filter((row) => row.academicSessionId === schoolA.academicSessionId).every((row) => row.sectionId === schoolA.sectionId)).toBe(true);
    expect(await prisma.studentAttendance.count({ where: { studentId: { in: promoting } } })).toBe(attendanceBefore);
  });

  it("refuses duplicates, a same-session target, and nothing is half-applied", async () => {
    // One already promoted and one not: the whole batch is refused.
    const mixed = [schoolA.studentIds[0]!, schoolA.studentIds[2]!];
    await expect(
      promoteStudents(adminOf(schoolA), { fromSessionId: schoolA.academicSessionId, toSectionId: nextSectionId, studentIds: mixed }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.studentEnrollment.count({ where: { studentId: schoolA.studentIds[2]!, academicSessionId: nextSessionId } })).toBe(0);

    await expect(
      promoteStudents(adminOf(schoolA), {
        fromSessionId: schoolA.academicSessionId,
        toSectionId: schoolA.unassignedSectionId,
        studentIds: [schoolA.studentIds[2]!],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("is School Admin only and stays inside the school", async () => {
    const input = { fromSessionId: schoolA.academicSessionId, toSectionId: nextSectionId, studentIds: [schoolA.studentIds[2]!] };
    await expect(promoteStudents(teacherOf(schoolA), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(promoteStudents(adminOf(schoolB), input)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      promoteStudents(adminOf(schoolA), { ...input, studentIds: [schoolB.studentIds[0]!] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("section change and status", () => {
  it("moves students within the session and clears their roll numbers", async () => {
    const studentId = schoolA.studentIds[2]!;
    const { moved } = await changeSection(adminOf(schoolA), { toSectionId: schoolA.unassignedSectionId, studentIds: [studentId] });
    expect(moved).toBe(1);
    const row = await prisma.studentEnrollment.findFirstOrThrow({ where: { studentId, academicSessionId: schoolA.academicSessionId } });
    expect(row.sectionId).toBe(schoolA.unassignedSectionId);
    expect(row.rollNumber).toBeNull();
    await expect(changeSection(adminOf(schoolB), { toSectionId: schoolB.sectionId, studentIds: [studentId] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("disables the login of a student who leaves, and restores it on return", async () => {
    const studentId = schoolA.studentIds[0]!;
    await setStudentsStatus(adminOf(schoolA), { status: "TRANSFERRED", studentIds: [studentId] });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: schoolA.studentUserId } })).isActive).toBe(false);
    await setStudentsStatus(adminOf(schoolA), { status: "ACTIVE", studentIds: [studentId] });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: schoolA.studentUserId } })).isActive).toBe(true);
  });
});

describe("CSV import", () => {
  const header =
    "Admission no.,First name,Last name,Gender,Date of birth,Class,Section,Roll no.,Guardian first name,Guardian last name,Guardian phone,Guardian email,Relationship";

  it("writes nothing when any row is bad, and names every bad row", async () => {
    const before = await prisma.student.count({ where: { schoolId: schoolA.schoolId } });
    const csv = [
      header,
      "NEW1,Riya,Verma,Girl,2014-02-01,Class 10,A,50,Sunil,Verma,9811111111,,Father",
      "ADM1,Taken,Number,Boy,2014-02-01,Class 10,A,,Kiran,Das,9822222222,,Mother", // admission no. exists
      "NEW3,No,Section,Boy,2014-02-01,Class 99,Z,,Kiran,Das,9822222222,,Mother", // unknown section
      "NEW4,Future,Child,Boy,2099-01-01,Class 10,A,,Kiran,Das,9822222222,,Mother", // future DOB
      "NEW5,No,Phone,Boy,,Class 10,A,,Kiran,Das,,,", // missing phone
    ].join("\n");
    const result = await importStudents(adminOf(schoolA), csv);
    expect(result.created).toBe(0);
    expect(result.errors.map((error) => error.line)).toEqual([3, 4, 5, 6]);
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId } })).toBe(before);
  });

  it("admits a valid file, placing each student and linking a known guardian by phone", async () => {
    const parentsBefore = await prisma.parent.count({ where: { schoolId: schoolA.schoolId } });
    const csv = [
      header,
      "NEW1,Riya,Verma,Girl,01/02/2014,Class 10,A,51,Sunil,Verma,9811111111,sunil@example.test,Father",
      // The fixture guardian's phone: linked, not duplicated.
      ",Kabir,Guardian,M,,Class 10,B,,,,+91 90000 00001,,Guardian",
    ].join("\r\n");
    const result = await importStudents(adminOf(schoolA), csv);
    expect(result.errors).toEqual([]);
    expect(result.created).toBe(2);
    expect(await prisma.parent.count({ where: { schoolId: schoolA.schoolId } })).toBe(parentsBefore + 1);

    const riya = await prisma.student.findFirstOrThrow({
      where: { schoolId: schoolA.schoolId, admissionNumber: "NEW1" },
      select: { gender: true, enrollments: { select: { sectionId: true, rollNumber: true } } },
    });
    expect(riya.gender).toBe("FEMALE");
    expect(riya.enrollments[0]).toMatchObject({ sectionId: schoolA.sectionId, rollNumber: "51" });

    const kabir = await prisma.student.findFirstOrThrow({
      where: { schoolId: schoolA.schoolId, firstName: "Kabir" },
      select: { parents: { select: { parentId: true } } },
    });
    expect(kabir.parents[0]?.parentId).toBe(schoolA.parentId);
    // Nothing landed in the other school with the same class and section names.
    expect(await prisma.student.count({ where: { schoolId: schoolB.schoolId, firstName: { in: ["Riya", "Kabir"] } } })).toBe(0);
  });

  it("is refused to anyone but the School Admin", async () => {
    await expect(importStudents(teacherOf(schoolA), header)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
