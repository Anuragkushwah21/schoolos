/**
 * Whole-school student promotion.
 *
 *   * The preview suggests the next class and the same section letter, marks
 *     the final class as graduating, and sorts students into ready / review /
 *     not eligible — without writing anything.
 *   * A batch adds a placement in the new session and closes, never edits,
 *     the old one: same section, same roll number, attendance untouched.
 *   * New sections start with no class teacher; subject teachers are not copied.
 *   * Repeating a batch moves nobody twice; a student who left is skipped.
 *   * A batch that fails part-way writes nothing.
 *   * Final-class students graduate through the people lifecycle.
 *   * School Admin only, and one school can never reach another's students.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  decodeDestination,
  encodeDestination,
  previewPromotion,
  promotionHistory,
  runPromotionBatch,
} from "@/server/academics/promotion";
import { prisma } from "@/server/db/prisma";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let nextSessionId: string;
let earlierSessionId: string;
let class11Id: string;
let class12Id: string;
let finalSectionId: string;
let finalStudentIds: string[];

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const schoolId = schoolA.schoolId;

  nextSessionId = (
    await prisma.academicSession.create({
      data: { schoolId, name: "2027-28", startDate: new Date(Date.UTC(2027, 3, 1)), endDate: new Date(Date.UTC(2028, 2, 31)) },
    })
  ).id;
  earlierSessionId = (
    await prisma.academicSession.create({
      data: { schoolId, name: "2025-26", startDate: new Date(Date.UTC(2025, 3, 1)), endDate: new Date(Date.UTC(2026, 2, 31)) },
    })
  ).id;
  class11Id = (await prisma.class.create({ data: { schoolId, name: "Class 11", level: 11 } })).id;
  class12Id = (await prisma.class.create({ data: { schoolId, name: "Class 12", level: 12 } })).id;

  // The school's final class, with two students in this session.
  finalSectionId = (
    await prisma.section.create({ data: { schoolId, academicSessionId: schoolA.academicSessionId, classId: class12Id, name: "A" } })
  ).id;
  finalStudentIds = [];
  for (const [index, name] of ["Kavya", "Dev"].entries()) {
    const student = await prisma.student.create({
      data: { schoolId, admissionNumber: `FIN${index}`, firstName: name, lastName: "A", gender: "FEMALE" },
    });
    await prisma.studentEnrollment.create({
      data: {
        schoolId,
        studentId: student.id,
        academicSessionId: schoolA.academicSessionId,
        classId: class12Id,
        sectionId: finalSectionId,
        rollNumber: String(index + 1),
      },
    });
    finalStudentIds.push(student.id);
  }

  // Aarav ready, Ananya on leave (review), Ishaan transferred (not eligible).
  await prisma.student.update({ where: { id: schoolA.studentIds[1]! }, data: { status: "ON_LEAVE" } });
  await prisma.student.update({ where: { id: schoolA.studentIds[2]! }, data: { status: "TRANSFERRED" } });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

function batch(overrides: Partial<Parameters<typeof runPromotionBatch>[1]> = {}): Parameters<typeof runPromotionBatch>[1] {
  return {
    runId: randomUUID(),
    fromSessionId: schoolA.academicSessionId,
    toSessionId: nextSessionId,
    fromSectionId: schoolA.sectionId,
    destination: { kind: "NEW_SECTION", classId: class11Id, name: "A" },
    students: [{ studentId: schoolA.studentIds[0]!, repeat: false }],
    ...overrides,
  };
}

describe("preview", () => {
  it("suggests the next class, graduates the final class, and sorts students — writing nothing", async () => {
    const before = await prisma.studentEnrollment.count({ where: { schoolId: schoolA.schoolId } });
    const preview = await previewPromotion(adminOf(schoolA), {
      fromSessionId: schoolA.academicSessionId,
      toSessionId: nextSessionId,
      sectionIds: [schoolA.sectionId, schoolA.unassignedSectionId, finalSectionId],
    });

    const tenA = preview.groups.find((g) => g.fromSectionId === schoolA.sectionId)!;
    expect(decodeDestination(tenA.suggested)).toEqual({ kind: "NEW_SECTION", classId: class11Id, name: "A" });
    expect(tenA.students.map((s) => s.eligibility)).toEqual(["READY", "REVIEW", "BLOCKED"]);
    expect(tenA.students[2]!.reason).toMatch(/Transferred/);

    const empty = preview.groups.find((g) => g.fromSectionId === schoolA.unassignedSectionId)!;
    expect(empty.students).toEqual([]);

    const final = preview.groups.find((g) => g.fromSectionId === finalSectionId)!;
    expect(final.isFinalClass).toBe(true);
    expect(final.suggested).toBe("GRADUATE");

    expect(await prisma.studentEnrollment.count({ where: { schoolId: schoolA.schoolId } })).toBe(before);
  });

  it("refuses the same or an earlier session", async () => {
    const input = { fromSessionId: schoolA.academicSessionId, sectionIds: [schoolA.sectionId] };
    await expect(previewPromotion(adminOf(schoolA), { ...input, toSessionId: schoolA.academicSessionId })).rejects.toBeInstanceOf(AppError);
    await expect(previewPromotion(adminOf(schoolA), { ...input, toSessionId: earlierSessionId })).rejects.toBeInstanceOf(AppError);
  });
});

describe("promotion batch", () => {
  it("fails as a whole: a full target section leaves nothing behind", async () => {
    const tight = await prisma.section.create({
      data: { schoolId: schoolA.schoolId, academicSessionId: nextSessionId, classId: class11Id, name: "Z", capacity: 1 },
    });
    await expect(
      runPromotionBatch(
        adminOf(schoolA),
        batch({
          fromSectionId: finalSectionId,
          destination: { kind: "SECTION", sectionId: tight.id },
          students: [
            { studentId: finalStudentIds[0]!, repeat: false },
            { studentId: finalStudentIds[1]!, repeat: false },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.studentEnrollment.count({ where: { studentId: { in: finalStudentIds }, academicSessionId: nextSessionId } })).toBe(0);
    expect(await prisma.studentEnrollment.count({ where: { studentId: { in: finalStudentIds }, status: "COMPLETED" } })).toBe(0);
    await prisma.section.delete({ where: { id: tight.id } });
  });

  it("creates the new placement, closes the old one untouched, and copies no teachers", async () => {
    const attendanceBefore = await prisma.studentAttendance.count({ where: { schoolId: schoolA.schoolId } });
    const result = await runPromotionBatch(
      adminOf(schoolA),
      batch({
        students: [
          { studentId: schoolA.studentIds[0]!, repeat: false },
          // Included by the admin after review, and kept in the same class.
          { studentId: schoolA.studentIds[1]!, repeat: true },
        ],
      }),
    );
    expect(result).toMatchObject({ promoted: 1, repeated: 1, graduated: 0, skipped: [] });

    const aarav = await prisma.studentEnrollment.findMany({
      where: { studentId: schoolA.studentIds[0]! },
      select: { academicSessionId: true, sectionId: true, rollNumber: true, status: true, section: { select: { classId: true, name: true, classTeacherId: true } } },
    });
    const old = aarav.find((row) => row.academicSessionId === schoolA.academicSessionId)!;
    const next = aarav.find((row) => row.academicSessionId === nextSessionId)!;
    expect(old).toMatchObject({ sectionId: schoolA.sectionId, rollNumber: "1", status: "COMPLETED" });
    expect(next).toMatchObject({ status: "ACTIVE", rollNumber: null });
    expect(next.section).toEqual({ classId: class11Id, name: "A", classTeacherId: null });

    const ananya = await prisma.studentEnrollment.findFirstOrThrow({
      where: { studentId: schoolA.studentIds[1]!, academicSessionId: nextSessionId },
      select: { section: { select: { classId: true, name: true } } },
    });
    expect(ananya.section).toEqual({ classId: schoolA.classId, name: "A" });

    expect(await prisma.studentAttendance.count({ where: { schoolId: schoolA.schoolId } })).toBe(attendanceBefore);
    expect(await prisma.teacherSubjectAssignment.count({ where: { academicSessionId: nextSessionId } })).toBe(0);
    // Last year's class teacher is still last year's.
    expect((await prisma.section.findUniqueOrThrow({ where: { id: schoolA.sectionId } })).classTeacherId).toBe(schoolA.teacherId);
  });

  it("never moves a student twice, and skips one who has left", async () => {
    const result = await runPromotionBatch(
      adminOf(schoolA),
      batch({
        students: [
          { studentId: schoolA.studentIds[0]!, repeat: false },
          { studentId: schoolA.studentIds[2]!, repeat: false },
        ],
      }),
    );
    expect(result.promoted).toBe(0);
    expect(result.skipped.map((s) => s.studentId).sort()).toEqual([schoolA.studentIds[0]!, schoolA.studentIds[2]!].sort());
    expect(await prisma.studentEnrollment.count({ where: { studentId: schoolA.studentIds[0]!, academicSessionId: nextSessionId } })).toBe(1);
    expect(await prisma.studentEnrollment.count({ where: { studentId: schoolA.studentIds[2]!, academicSessionId: nextSessionId } })).toBe(0);
  });

  it("graduates the final class through the lifecycle instead of inventing a next class", async () => {
    const result = await runPromotionBatch(
      adminOf(schoolA),
      batch({
        fromSectionId: finalSectionId,
        destination: { kind: "GRADUATE" },
        students: finalStudentIds.map((studentId) => ({ studentId, repeat: false })),
      }),
    );
    expect(result).toMatchObject({ promoted: 0, graduated: 2 });
    const students = await prisma.student.findMany({ where: { id: { in: finalStudentIds } }, select: { status: true } });
    expect(students.every((s) => s.status === "GRADUATED")).toBe(true);
    expect(await prisma.studentEnrollment.count({ where: { studentId: { in: finalStudentIds }, academicSessionId: nextSessionId } })).toBe(0);
    expect(await prisma.statusChange.count({ where: { studentId: { in: finalStudentIds }, toValue: "GRADUATED" } })).toBe(2);
    expect(await prisma.class.count({ where: { schoolId: schoolA.schoolId, level: { gt: 12 } } })).toBe(0);
  });

  it("refuses a student who is not in the chosen section", async () => {
    await expect(
      runPromotionBatch(adminOf(schoolA), batch({ fromSectionId: schoolA.unassignedSectionId })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("history", () => {
  it("groups a run's batches from the audit log", async () => {
    const runId = randomUUID();
    const fresh = await prisma.student.create({
      data: { schoolId: schoolA.schoolId, admissionNumber: "HIST1", firstName: "Meera", lastName: "A", gender: "FEMALE" },
    });
    await prisma.studentEnrollment.create({
      data: { schoolId: schoolA.schoolId, studentId: fresh.id, academicSessionId: schoolA.academicSessionId, classId: schoolA.classId, sectionId: schoolA.unassignedSectionId },
    });
    await runPromotionBatch(
      adminOf(schoolA),
      batch({ runId, fromSectionId: schoolA.unassignedSectionId, destination: { kind: "NEW_SECTION", classId: class11Id, name: "B" }, students: [{ studentId: fresh.id, repeat: false }] }),
    );
    const history = await promotionHistory(adminOf(schoolA));
    const run = history.find((entry) => entry.id === runId)!;
    expect(run).toMatchObject({ promoted: 1, toName: "2027-28" });
    expect(await promotionHistory(adminOf(schoolB))).toEqual([]);
  });
});

describe("permissions and tenant isolation", () => {
  it("is School Admin only", async () => {
    await expect(
      previewPromotion(teacherOf(schoolA), { fromSessionId: schoolA.academicSessionId, toSessionId: nextSessionId, sectionIds: [schoolA.sectionId] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runPromotionBatch(teacherOf(schoolA), batch())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("School B cannot see or promote School A's students, nor A reach B's", async () => {
    await expect(
      previewPromotion(adminOf(schoolB), { fromSessionId: schoolA.academicSessionId, toSessionId: nextSessionId, sectionIds: [schoolA.sectionId] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(runPromotionBatch(adminOf(schoolB), batch())).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runPromotionBatch(adminOf(schoolA), batch({ students: [{ studentId: schoolB.studentIds[0]!, repeat: false }] })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.studentEnrollment.count({ where: { studentId: { in: schoolB.studentIds }, academicSessionId: nextSessionId } })).toBe(0);
  });
});

describe("destination encoding", () => {
  it("round-trips and rejects junk", () => {
    for (const d of [{ kind: "GRADUATE" }, { kind: "SECTION", sectionId: "s1" }, { kind: "NEW_SECTION", classId: "c1", name: "A" }] as const) {
      expect(decodeDestination(encodeDestination(d))).toEqual(d);
    }
    expect(decodeDestination("NEW:c1:")).toBeNull();
    expect(decodeDestination("DROP TABLE")).toBeNull();
  });
});
