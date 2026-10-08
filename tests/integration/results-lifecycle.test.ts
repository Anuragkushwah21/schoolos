/**
 * Results, start to finish: a school's own grading scale, exempt papers,
 * submit → verify → publish, corrections after publishing (audited with the
 * old and new mark), the weighted final result, and who may see what — with
 * last session's report cards kept after the session rolls over.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, toDateInput, today } from "@/lib/dates";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createExamSchema } from "@/lib/validation/exams";
import { prisma } from "@/server/db/prisma";
import { finalResultFor, finalResultsForSection, saveResultScheme } from "@/server/exams/final-results";
import { saveGradingRules } from "@/server/exams/grading";
import { getReportCard, publishedExamsFor } from "@/server/exams/results";
import { correctPublishedResult, createExams, getExamDetail, getMarksSheet, publishExams, saveMarks, submitMarks, verifyExam } from "@/server/exams/service";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let scienceId: string;
const exams: Record<string, string> = {};
const parentA = () => contextFor(schoolA, schoolA.parentUserId, "PARENT");
const studentA = () => contextFor(schoolA, schoolA.studentUserId, "STUDENT");

/** Create an exam (two papers: maths 100, science 50) and enter marks: student 0 gets `first`, the rest 50%. */
async function examWithMarks(name: string, startOffset: number, first: { maths: number; science: number | "EXEMPT" | "ABSENT" }) {
  const { ids } = await createExams(
    adminOf(schoolA),
    createExamSchema.parse({
      name,
      sectionIds: [schoolA.sectionId],
      startDate: toDateInput(addDays(today(), startOffset)),
      endDate: toDateInput(addDays(today(), startOffset + 2)),
      papers: [
        { subjectId: schoolA.subjectId, maxMarks: "100", passMarks: "" },
        { subjectId: scienceId, maxMarks: "50", passMarks: "" },
      ],
    }),
  );
  const examId = ids[0]!;
  exams[name] = examId;
  const detail = await getExamDetail(adminOf(schoolA), examId);
  for (const paper of detail.papers) {
    const sheet = await getMarksSheet(adminOf(schoolA), paper.id);
    const isMaths = paper.subjectId === schoolA.subjectId;
    await saveMarks(
      adminOf(schoolA),
      paper.id,
      sheet.rows.map((row) => {
        if (row.studentId !== schoolA.studentIds[0]) return { studentId: row.studentId, marks: paper.maxMarks / 2, absent: false, remark: null };
        const value = isMaths ? first.maths : first.science;
        if (value === "EXEMPT") return { studentId: row.studentId, marks: null, absent: false, exempt: true, remark: null };
        if (value === "ABSENT") return { studentId: row.studentId, marks: null, absent: true, remark: null };
        return { studentId: row.studentId, marks: value, absent: false, remark: null };
      }),
    );
  }
  return { examId, papers: detail.papers };
}

async function publish(name: string) {
  const detail = await getExamDetail(adminOf(schoolA), exams[name]!);
  for (const paper of detail.papers) await submitMarks(adminOf(schoolA), paper.id);
  await verifyExam(adminOf(schoolA), exams[name]!);
  await publishExams(adminOf(schoolA), [exams[name]!]);
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  scienceId = (await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "Science", code: "SCI-R" } })).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("grading and exempt papers", () => {
  it("uses the school's own scale and pass percentage; an exempt paper leaves the total", async () => {
    await expect(saveGradingRules(adminOf(schoolA), { bands: [{ min: 50, grade: "P" }, { min: 10, grade: "F" }], passPercent: 40 })).rejects.toThrow(/start at 0%/);
    await expect(saveGradingRules(teacherOf(schoolA), { bands: null, passPercent: 40 })).rejects.toBeInstanceOf(ForbiddenError);
    await saveGradingRules(adminOf(schoolA), { bands: [{ min: 90, grade: "O" }, { min: 75, grade: "A" }, { min: 40, grade: "B" }, { min: 0, grade: "F" }], passPercent: 40 });

    await examWithMarks("Half-Yearly", -20, { maths: 80, science: "EXEMPT" });
    const detail = await getExamDetail(adminOf(schoolA), exams["Half-Yearly"]!);
    const first = detail.students.find((row) => row.studentId === schoolA.studentIds[0])!;
    // Science (50) is left out: 80 out of 100, not 80 out of 150.
    expect(first).toMatchObject({ total: 80, maxTotal: 100, percent: 80, grade: "A", outcome: "PASS" });
    const other = detail.students.find((row) => row.studentId !== schoolA.studentIds[0])!;
    expect(other).toMatchObject({ total: 75, maxTotal: 150, percent: 50, grade: "B" });
    expect(detail.papers[0]?.passMarks).toBeNull();
  });
});

describe("submit → verify → publish", () => {
  it("nothing reaches families until verified and published; teachers cannot verify or publish", async () => {
    const examId = exams["Half-Yearly"]!;
    await expect(getReportCard(parentA(), examId, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(verifyExam(adminOf(schoolA), examId)).rejects.toThrow(/not submitted/);
    const detail = await getExamDetail(adminOf(schoolA), examId);
    for (const paper of detail.papers) await submitMarks(adminOf(schoolA), paper.id);
    await expect(verifyExam(teacherOf(schoolA), examId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishExams(adminOf(schoolA), [examId])).rejects.toThrow(/Not verified/);
    await verifyExam(adminOf(schoolA), examId);
    await expect(publishExams(teacherOf(schoolA), [examId])).rejects.toBeInstanceOf(ForbiddenError);
    await publishExams(adminOf(schoolA), [examId]);

    const card = await getReportCard(parentA(), examId, schoolA.studentIds[0]!);
    expect(card).toMatchObject({ percent: 80, grade: "A", grading: { passPercent: 40, key: "O 90–100 · A 75–89 · B 40–74 · F 0–39" } });
    expect(card.subjects.find((row) => row.subject === "Science")).toMatchObject({ exempt: true, marksObtained: null });
    await expect(getReportCard(contextFor(schoolB, schoolB.parentUserId, "PARENT"), examId, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a published mark is corrected with a reason; the audit keeps old and new; families see the new one", async () => {
    const examId = exams["Half-Yearly"]!;
    const maths = (await getExamDetail(adminOf(schoolA), examId)).papers.find((paper) => paper.subjectId === schoolA.subjectId)!;
    const input = { assessmentId: maths.id, studentId: schoolA.studentIds[0]!, marks: 92, status: "MARKS" as const, reason: "Re-totalled the answer sheet" };
    await expect(correctPublishedResult(teacherOf(schoolA), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(correctPublishedResult(adminOf(schoolA), { ...input, marks: 101 })).rejects.toBeInstanceOf(AppError);
    await expect(correctPublishedResult(adminOf(schoolA), { ...input, reason: " " })).rejects.toThrow(/why/);
    await expect(correctPublishedResult(adminOf(schoolA), { ...input, studentId: schoolB.studentIds[0]! })).rejects.toBeInstanceOf(NotFoundError);
    await correctPublishedResult(adminOf(schoolA), input);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "RESULT_CORRECTED", entityId: maths.id } });
    expect(audit.metadata).toMatchObject({ from: { marksObtained: 80 }, to: { marksObtained: 92 }, reason: "Re-totalled the answer sheet" });
    expect(audit.actorId).toBe(schoolA.adminUserId);
    const card = await getReportCard(studentA(), examId, schoolA.studentIds[0]!);
    expect(card).toMatchObject({ total: 92, percent: 92, grade: "O" });
  });
});

describe("the weighted final result", () => {
  it("validates the weights and the exam names", async () => {
    await expect(saveResultScheme(adminOf(schoolA), { name: "Final", components: [{ examName: "Half-Yearly", weight: 40 }, { examName: "Annual", weight: 50 }] })).rejects.toThrow(/add up to 90/);
    await expect(saveResultScheme(adminOf(schoolA), { name: "Final", components: [{ examName: "Half-Yearly", weight: 40 }, { examName: "Nonexistent", weight: 60 }] })).rejects.toThrow(/no exam called/);
    await expect(saveResultScheme(teacherOf(schoolA), { name: "Final", components: [{ examName: "Half-Yearly", weight: 100 }] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("weights each exam's percentage per subject, and families see it only once every exam is published", async () => {
    await examWithMarks("Annual", -6, { maths: 60, science: 30 });
    await saveResultScheme(adminOf(schoolA), { name: "Final result", components: [{ examName: "Half-Yearly", weight: 40 }, { examName: "Annual", weight: 60 }] });
    // Annual not published yet: families see nothing; the office sees it as waiting.
    expect(await finalResultFor(parentA(), schoolA.studentIds[0]!)).toBeNull();
    const waiting = await finalResultsForSection(adminOf(schoolA), schoolA.sectionId);
    expect(waiting.rows.find((row) => row.studentId === schoolA.studentIds[0])).toMatchObject({ complete: false, missing: ["Annual"], outcome: "INCOMPLETE" });

    await publish("Annual");
    const final = (await finalResultFor(parentA(), schoolA.studentIds[0]!))!;
    // Maths: 92% × 40 + 60% × 60 = 72.8%. Science: exempt in Half-Yearly, so Annual's 60% alone.
    expect(final.subjects.find((row) => row.subject === "Science")).toMatchObject({ percent: 60, grade: "B", passed: true });
    expect(final.subjects.find((row) => row.subject !== "Science")).toMatchObject({ percent: 72.8, grade: "B" });
    // Overall: Half-Yearly 92% (92/100) × 40 + Annual 60% (90/150) × 60 = 72.8%.
    expect(final).toMatchObject({ complete: true, percent: 72.8, outcome: "PASS" });
    await expect(finalResultFor(contextFor(schoolB, schoolB.parentUserId, "PARENT"), schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(finalResultsForSection(adminOf(schoolB), schoolA.sectionId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("history", () => {
  it("last session's published results stay with the family after the session rolls over", async () => {
    const old = await prisma.academicSession.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, isCurrent: true } });
    await prisma.academicSession.update({ where: { id: old.id }, data: { isCurrent: false } });
    const next = await prisma.academicSession.create({ data: { schoolId: schoolA.schoolId, name: "Next year (results test)", startDate: addDays(today(), 1), endDate: addDays(today(), 365), isCurrent: true } });
    try {
      await prisma.studentEnrollment.updateMany({ where: { studentId: schoolA.studentIds[0]!, academicSessionId: old.id }, data: { status: "COMPLETED" } });
      const listed = await publishedExamsFor(parentA(), schoolA.studentIds[0]!);
      expect(listed.map((row) => row.id)).toEqual(expect.arrayContaining([exams["Half-Yearly"], exams["Annual"]]));
      expect(listed.every((row) => row.currentSession === false && row.session === old.name)).toBe(true);
      // Marks never moved: the old report card still reads the same.
      expect((await getReportCard(parentA(), exams["Half-Yearly"]!, schoolA.studentIds[0]!)).percent).toBe(92);
    } finally {
      await prisma.studentEnrollment.updateMany({ where: { studentId: schoolA.studentIds[0]!, academicSessionId: old.id }, data: { status: "ACTIVE" } });
      await prisma.academicSession.update({ where: { id: next.id }, data: { isCurrent: false } });
      await prisma.academicSession.delete({ where: { id: next.id } });
      await prisma.academicSession.update({ where: { id: old.id }, data: { isCurrent: true } });
    }
  });
});
