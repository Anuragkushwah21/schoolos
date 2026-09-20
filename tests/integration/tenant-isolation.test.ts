/**
 * MANDATORY tenant isolation suite.
 *
 * Two schools, each with real data, and the requirement that neither can see
 * or touch the other's records through any route.
 *
 * Isolation is checked at both layers independently:
 *   1. The application layer — `forSchool()` scoping every query.
 *   2. PostgreSQL — composite foreign keys rejecting cross-tenant rows even
 *      when the application layer is bypassed entirely.
 *
 * Layer 2 matters most: it is what still holds if someone writes a query that
 * forgets to scope.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { forSchool } from "@/server/tenancy/scope";

import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

beforeAll(async () => {
  const fixture = await createIsolationFixture();
  schoolA = fixture.schoolA;
  schoolB = fixture.schoolB;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("application layer: forSchool() scoping", () => {
  it("returns only its own students", async () => {
    const db = forSchool(schoolA.schoolId);
    const students = await db.student.findMany();

    expect(students).toHaveLength(schoolA.studentIds.length);
    expect(students.every((s) => s.schoolId === schoolA.schoolId)).toBe(true);
  });

  it("cannot read another school's student by id", async () => {
    const db = forSchool(schoolA.schoolId);
    const target = schoolB.studentIds[0]!;

    // The row exists...
    await expect(
      prisma.student.findUnique({ where: { id: target } }),
    ).resolves.not.toBeNull();

    // ...but not for School A.
    await expect(
      db.student.findUnique({ where: { id: target } }),
    ).resolves.toBeNull();
    await expect(
      db.student.findFirst({ where: { id: target } }),
    ).resolves.toBeNull();
  });

  it("returns nothing when the caller filters for another school", async () => {
    const db = forSchool(schoolA.schoolId);

    // Asking for School B's students must yield an empty result — not School
    // A's students. Scoping narrows the query; it never rewrites it into a
    // different question.
    const students = await db.student.findMany({
      where: { schoolId: schoolB.schoolId },
    });

    expect(students).toHaveLength(0);
  });

  it("counts only its own students", async () => {
    const [countA, countB] = await Promise.all([
      forSchool(schoolA.schoolId).student.count(),
      forSchool(schoolB.schoolId).student.count(),
    ]);

    expect(countA).toBe(schoolA.studentIds.length);
    expect(countB).toBe(schoolB.studentIds.length);
    expect(countA).not.toBe(countB);
  });

  it("cannot update another school's student", async () => {
    const db = forSchool(schoolA.schoolId);
    const target = schoolB.studentIds[0]!;

    const result = await db.student.updateMany({
      where: { id: target },
      data: { lastName: "Tampered" },
    });

    expect(result.count).toBe(0);

    const untouched = await prisma.student.findUnique({ where: { id: target } });
    expect(untouched?.lastName).not.toBe("Tampered");
  });

  it("cannot delete another school's student", async () => {
    const db = forSchool(schoolA.schoolId);
    const target = schoolB.studentIds[0]!;

    const result = await db.student.deleteMany({ where: { id: target } });

    expect(result.count).toBe(0);
    await expect(
      prisma.student.findUnique({ where: { id: target } }),
    ).resolves.not.toBeNull();
  });

  it("stamps its own schoolId on create, overriding any supplied value", async () => {
    const db = forSchool(schoolA.schoolId);

    const created = await db.student.create({
      data: {
        // A hostile caller trying to plant a row in School B:
        schoolId: schoolB.schoolId,
        admissionNumber: "ISO-CREATE-1",
        firstName: "Scoped",
        lastName: "Create",
      },
    });

    expect(created.schoolId).toBe(schoolA.schoolId);

    await prisma.student.delete({ where: { id: created.id } });
  });

  it("scopes every other school-owned model the same way", async () => {
    const a = forSchool(schoolA.schoolId);

    const [sections, teachers, notices, sessions] = await Promise.all([
      a.section.findMany(),
      a.teacher.findMany(),
      a.notice.findMany(),
      a.academicSession.findMany(),
    ]);

    expect(sections.length).toBeGreaterThan(0);
    expect(teachers.length).toBeGreaterThan(0);
    expect(notices.length).toBeGreaterThan(0);
    expect(sessions.length).toBeGreaterThan(0);

    for (const row of [...sections, ...teachers, ...notices, ...sessions]) {
      expect(row.schoolId).toBe(schoolA.schoolId);
    }
  });

  it("resolves the School row to the caller's own school only", async () => {
    const a = forSchool(schoolA.schoolId);

    await expect(
      a.school.findUnique({ where: { id: schoolB.schoolId } }),
    ).resolves.toBeNull();

    const own = await a.school.findUnique({ where: { id: schoolA.schoolId } });
    expect(own?.id).toBe(schoolA.schoolId);
  });

  it("refuses an operation nobody has scoped yet", async () => {
    const a = forSchool(schoolA.schoolId);

    // `findRaw` is not in either operation list, so it must throw rather than
    // silently run unscoped across the platform.
    await expect(
      // @ts-expect-error — deliberately calling an unsupported operation.
      a.student.findRaw({}),
    ).rejects.toThrow(/Unscoped tenant operation/);
  });
});

describe("database layer: composite foreign keys", () => {
  it("rejects a section that points at another school's class", async () => {
    // Bypasses the scoping extension entirely — this is the raw client.
    await expect(
      prisma.section.create({
        data: {
          schoolId: schoolB.schoolId,
          academicSessionId: schoolB.academicSessionId,
          classId: schoolA.classId, // School A's class
          name: "ATTACK",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects an enrollment that mixes two schools", async () => {
    await expect(
      prisma.studentEnrollment.create({
        data: {
          schoolId: schoolB.schoolId,
          studentId: schoolA.studentIds[0]!, // School A's student
          academicSessionId: schoolB.academicSessionId,
          classId: schoolB.classId,
          sectionId: schoolB.sectionId,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects attendance written against another school's student", async () => {
    await expect(
      prisma.studentAttendance.create({
        data: {
          schoolId: schoolB.schoolId,
          academicSessionId: schoolB.academicSessionId,
          studentId: schoolA.studentIds[0]!,
          sectionId: schoolB.sectionId,
          date: new Date(Date.UTC(2026, 8, 18)),
          status: "PRESENT",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects linking a parent to another school's child", async () => {
    await expect(
      prisma.parentStudent.create({
        data: {
          schoolId: schoolB.schoolId,
          parentId: schoolB.parentId,
          studentId: schoolA.studentIds[0]!,
          relationship: "GUARDIAN",
        },
      }),
    ).rejects.toThrow();
  });

  it("still allows the same shapes within a single school", async () => {
    const section = await prisma.section.create({
      data: {
        schoolId: schoolB.schoolId,
        academicSessionId: schoolB.academicSessionId,
        classId: schoolB.classId,
        name: "LEGIT",
      },
    });

    expect(section.schoolId).toBe(schoolB.schoolId);
    await prisma.section.delete({ where: { id: section.id } });
  });
});
