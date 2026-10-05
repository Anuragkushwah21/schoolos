/**
 * Academic housekeeping that never destroys history: subjects and streams are
 * renamed or switched off (never deleted), and a promotion run can be undone
 * for every student who has nothing recorded in the new session yet.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { previewPromotionReversal, promotionHistory, reversePromotionRun, runPromotionBatch } from "@/server/academics/promotion";
import { listSubjects, setStreamActive, setSubjectActive, updateStream, updateSubject } from "@/server/academics/structure";
import { prisma } from "@/server/db/prisma";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let nextSessionId: string;
let class11Id: string;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  nextSessionId = (
    await prisma.academicSession.create({
      data: { schoolId: schoolA.schoolId, name: "2027-28 (rev)", startDate: new Date(Date.UTC(2027, 3, 1)), endDate: new Date(Date.UTC(2028, 2, 31)) },
    })
  ).id;
  class11Id = (await prisma.class.create({ data: { schoolId: schoolA.schoolId, name: "Class 11 (rev)", level: 11 } })).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("subjects and streams: rename and archive, never delete", () => {
  it("renames a subject and its code, keeping every record pointing at it", async () => {
    await updateSubject(adminOf(schoolA), { subjectId: schoolA.subjectId, name: "Mathematics (Core)", code: "MATH-C" });
    const subject = (await listSubjects(adminOf(schoolA))).find((row) => row.id === schoolA.subjectId)!;
    expect(subject).toMatchObject({ name: "Mathematics (Core)", code: "MATH-C" });
    // Assignments still point at the same subject.
    expect(await prisma.teacherSubjectAssignment.count({ where: { subjectId: schoolA.subjectId } })).toBeGreaterThan(0);

    const other = await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "Art", code: "ART-R" } });
    await expect(updateSubject(adminOf(schoolA), { subjectId: other.id, name: "Art", code: "MATH-C" })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateSubject(teacherOf(schoolA), { subjectId: other.id, name: "x", code: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSubject(adminOf(schoolB), { subjectId: other.id, name: "x", code: "X" })).rejects.toBeInstanceOf(NotFoundError);

    // Archive = switch off; the row stays.
    await setSubjectActive(adminOf(schoolA), other.id, false);
    expect((await prisma.subject.findUniqueOrThrow({ where: { id: other.id } })).isActive).toBe(false);
    expect((await listSubjects(adminOf(schoolA), { activeOnly: true })).some((row) => row.id === other.id)).toBe(false);
  });

  it("renames and archives a stream", async () => {
    const stream = await prisma.stream.create({ data: { schoolId: schoolA.schoolId, name: "Science (rev)" } });
    await prisma.stream.create({ data: { schoolId: schoolA.schoolId, name: "Arts (rev)" } });
    await updateStream(adminOf(schoolA), { streamId: stream.id, name: "Science & Maths" });
    expect((await prisma.stream.findUniqueOrThrow({ where: { id: stream.id } })).name).toBe("Science & Maths");
    await expect(updateStream(adminOf(schoolA), { streamId: stream.id, name: "Arts (rev)" })).rejects.toBeInstanceOf(ConflictError);
    await setStreamActive(adminOf(schoolA), stream.id, false);
    expect((await prisma.stream.findUniqueOrThrow({ where: { id: stream.id } })).isActive).toBe(false);
  });
});

describe("undoing a promotion", () => {
  it("puts back students with nothing recorded in the new session, keeps the others, and records it", async () => {
    const runId = randomUUID();
    const [first, second] = schoolA.studentIds;
    await runPromotionBatch(adminOf(schoolA), {
      runId,
      fromSessionId: schoolA.academicSessionId,
      toSessionId: nextSessionId,
      fromSectionId: schoolA.sectionId,
      destination: { kind: "NEW_SECTION", classId: class11Id, name: "A" },
      students: [
        { studentId: first!, repeat: false },
        { studentId: second!, repeat: false },
      ],
    });
    // The second student already has a fee charge in the new session: their placement is history now.
    const head = await prisma.feeHead.create({ data: { schoolId: schoolA.schoolId, name: "Tuition (rev)" } });
    await prisma.feeCharge.create({ data: { schoolId: schoolA.schoolId, academicSessionId: nextSessionId, studentId: second!, feeHeadId: head.id, amountMinor: 100_000, dueOn: new Date(Date.UTC(2027, 4, 1)) } });

    expect((await promotionHistory(adminOf(schoolA))).some((run) => run.id === runId)).toBe(true);
    const preview = await previewPromotionReversal(adminOf(schoolA), runId);
    expect(preview.canUndo).toBe(1);
    expect(preview.students.find((row) => row.studentId === second)?.blocker).toMatch(/fees in the new session/);

    await expect(reversePromotionRun(teacherOf(schoolA), runId, "wrong class")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(previewPromotionReversal(adminOf(schoolB), runId)).rejects.toBeInstanceOf(NotFoundError);

    const result = await reversePromotionRun(adminOf(schoolA), runId, "Promoted to the wrong class");
    expect(result.undone).toBe(1);
    // First student: back in last session's section, no new placement.
    const firstRows = await prisma.studentEnrollment.findMany({ where: { studentId: first! }, select: { academicSessionId: true, status: true } });
    expect(firstRows).toEqual([{ academicSessionId: schoolA.academicSessionId, status: "ACTIVE" }]);
    // Second student: untouched (still promoted; their fee charge is safe).
    expect(await prisma.studentEnrollment.count({ where: { studentId: second!, academicSessionId: nextSessionId } })).toBe(1);
    expect(await prisma.feeCharge.count({ where: { studentId: second!, academicSessionId: nextSessionId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { schoolId: schoolA.schoolId, action: "PROMOTION_REVERSED" } })).toBe(1);

    // Running it again changes nothing more.
    await expect(reversePromotionRun(adminOf(schoolA), runId, "again")).rejects.toBeInstanceOf(ConflictError);
  });
});
