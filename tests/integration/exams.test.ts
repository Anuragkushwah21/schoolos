/**
 * Examinations: exams, marks, publication and report cards.
 *
 * What must hold:
 *   * Only the School Admin creates, publishes and deletes exams.
 *   * A teacher enters marks only for a subject they teach in that section.
 *   * Marks are validated row by row; a CSV import saves nothing unless every
 *     row is valid.
 *   * Students and parents see an exam's marks only after it is published;
 *     class tests stay visible as soon as they are marked.
 *   * No school reaches another's exams, papers, marks or report cards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseCsv, readCsvRecords } from "@/lib/csv";
import { addDays, today, toDateInput } from "@/lib/dates";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { examOutcome, gradeFor, paperOutcome, passMarkFor, percentage } from "@/lib/grades";
import { createExamSchema } from "@/lib/validation/exams";
import { prisma } from "@/server/db/prisma";
import { getReportCard, publishedExamsFor } from "@/server/exams/results";
import {
  createClassTest,
  createExams,
  deleteExam,
  getExamDetail,
  getMarksSheet,
  importMarksCsv,
  listExams,
  listMyPapers,
  publishExams,
  saveMarks,
  unpublishExam,
} from "@/server/exams/service";
import { getChildResults } from "@/server/parent/child";
import { getMyResults } from "@/server/student/me";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let scienceId: string;
let examId: string;
let otherSectionExamId: string;
let mathsPaperId: string;
let sciencePaperId: string;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

const examInput = (overrides: Record<string, unknown> = {}) =>
  createExamSchema.parse({
    name: "Half-Yearly",
    sectionIds: [schoolA.sectionId, schoolA.unassignedSectionId],
    startDate: toDateInput(addDays(today(), -10)),
    endDate: toDateInput(addDays(today(), -5)),
    papers: [
      { subjectId: schoolA.subjectId, maxMarks: "100", passMarks: "33" },
      { subjectId: scienceId, maxMarks: "50", passMarks: "" },
    ],
    ...overrides,
  });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  scienceId = (await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "Science", code: "SCI" } })).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("grades and CSV reading", () => {
  it("grades on the nine-point scale and passes at 33% by default", () => {
    expect(percentage(91, 100)).toBe(91);
    expect(gradeFor(91)).toBe("A1");
    expect(gradeFor(90.9)).toBe("A2");
    expect(gradeFor(33)).toBe("D");
    expect(gradeFor(32.9)).toBe("E");
    expect(passMarkFor(50, null)).toBe(17);
    expect(paperOutcome({ maxMarks: 50, passMarks: null }, { marksObtained: 17, absent: false })).toBe("PASS");
    expect(paperOutcome({ maxMarks: 50, passMarks: null }, { marksObtained: null, absent: true })).toBe("ABSENT");
    expect(examOutcome(["PASS", "PASS"])).toBe("PASS");
    expect(examOutcome(["PASS", "ABSENT"])).toBe("FAIL");
    expect(examOutcome(["PASS", "PENDING"])).toBe("INCOMPLETE");
  });

  it("reads quoted CSV, Excel's byte-order mark and CRLF lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
    expect(() => readCsvRecords("Name\nA", { required: ["Admission no."] })).toThrow(/Missing column/);
  });
});

describe("creating exams", () => {
  it("rejects an exam that ends before it starts, or repeats a subject", () => {
    expect(
      createExamSchema.safeParse({
        name: "X",
        sectionIds: [schoolA.sectionId],
        startDate: "2026-10-10",
        endDate: "2026-10-01",
        papers: [{ subjectId: schoolA.subjectId, maxMarks: "10" }],
      }).success,
    ).toBe(false);
    expect(
      createExamSchema.safeParse({
        name: "X",
        sectionIds: [schoolA.sectionId],
        startDate: "2026-10-01",
        endDate: "2026-10-10",
        papers: [
          { subjectId: schoolA.subjectId, maxMarks: "10" },
          { subjectId: schoolA.subjectId, maxMarks: "10" },
        ],
      }).success,
    ).toBe(false);
  });

  it("creates the same exam for several sections at once, all or nothing", async () => {
    const { ids } = await createExams(adminOf(schoolA), examInput());
    expect(ids).toHaveLength(2);
    examId = (await prisma.exam.findFirstOrThrow({ where: { id: { in: ids }, sectionId: schoolA.sectionId } })).id;
    otherSectionExamId = ids.find((id) => id !== examId)!;

    const papers = await prisma.assessment.findMany({ where: { examId }, select: { id: true, subjectId: true, teacherId: true } });
    mathsPaperId = papers.find((paper) => paper.subjectId === schoolA.subjectId)!.id;
    sciencePaperId = papers.find((paper) => paper.subjectId === scienceId)!.id;
    // The maths paper is linked to the teacher assigned to it.
    expect(papers.find((paper) => paper.id === mathsPaperId)?.teacherId).toBe(schoolA.teacherId);

    // Repeating the name for one of the sections refuses the whole batch.
    const before = await prisma.exam.count({ where: { schoolId: schoolA.schoolId } });
    await expect(createExams(adminOf(schoolA), examInput())).rejects.toBeInstanceOf(AppError);
    expect(await prisma.exam.count({ where: { schoolId: schoolA.schoolId } })).toBe(before);
  });

  it("is School Admin only, and cannot reach another school's section or subject", async () => {
    await expect(createExams(teacherOf(schoolA), examInput({ name: "T" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createExams(adminOf(schoolB), examInput({ name: "Cross", sectionIds: [schoolA.sectionId] })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createExams(
        adminOf(schoolA),
        examInput({ name: "Cross subject", sectionIds: [schoolA.sectionId], papers: [{ subjectId: schoolB.subjectId, maxMarks: "10" }] }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await listExams(adminOf(schoolB))).map((exam) => exam.id)).not.toContain(examId);
  });
});

describe("entering marks", () => {
  it("lets the subject teacher enter marks and refuses bad rows", async () => {
    const teacher = teacherOf(schoolA);
    const sheet = await getMarksSheet(teacher, mathsPaperId);
    expect(sheet.rows).toHaveLength(schoolA.studentIds.length);

    await expect(
      saveMarks(teacher, mathsPaperId, [{ studentId: schoolA.studentIds[0]!, marks: 101, absent: false, remark: null }]),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveMarks(teacher, mathsPaperId, [{ studentId: schoolA.studentIds[0]!, marks: 40, absent: true, remark: null }]),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveMarks(teacher, mathsPaperId, [{ studentId: schoolB.studentIds[0]!, marks: 40, absent: false, remark: null }]),
    ).rejects.toBeInstanceOf(NotFoundError);

    const [first, ...rest] = schoolA.studentIds;
    await saveMarks(teacher, mathsPaperId, [
      { studentId: first!, marks: 92, absent: false, remark: "Excellent" },
      ...rest.map((studentId, index) => ({ studentId, marks: index === 0 ? null : 50, absent: index === 0, remark: null })),
    ]);
    const saved = await getMarksSheet(adminOf(schoolA), mathsPaperId);
    expect(saved.rows.find((row) => row.studentId === first)?.marksObtained).toBe(92);
    expect(saved.rows.find((row) => row.studentId === rest[0])?.absent).toBe(true);
  });

  it("keeps a teacher to the subjects and sections they teach", async () => {
    // Science in their own section: not their subject.
    await expect(getMarksSheet(teacherOf(schoolA), sciencePaperId)).rejects.toBeInstanceOf(ForbiddenError);
    const otherPaper = await prisma.assessment.findFirstOrThrow({ where: { examId: otherSectionExamId, subjectId: schoolA.subjectId } });
    // Maths in a section they do not teach.
    await expect(getMarksSheet(teacherOf(schoolA), otherPaper.id)).rejects.toBeInstanceOf(ForbiddenError);
    // Another school's teacher and admin see nothing.
    await expect(getMarksSheet(teacherOf(schoolB), mathsPaperId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveMarks(adminOf(schoolB), mathsPaperId, [{ studentId: schoolA.studentIds[0]!, marks: 1, absent: false, remark: null }]),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Parents and students never enter marks.
    await expect(getMarksSheet(parentOf(schoolA), mathsPaperId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("imports a CSV only when every row is valid", async () => {
    const admissions = await prisma.student.findMany({
      where: { id: { in: schoolA.studentIds } },
      select: { id: true, admissionNumber: true },
    });
    const bad = ["Admission no.,Marks,Absent,Remark", ...admissions.map((s, i) => `${s.admissionNumber},${i === 0 ? "60" : "abc"},,`), "NOPE,10,,"].join("\n");
    const failed = await importMarksCsv(adminOf(schoolA), sciencePaperId, bad);
    expect(failed.saved).toBe(0);
    expect(failed.errors.length).toBeGreaterThanOrEqual(2);
    expect(failed.errors.some((error) => /more than the maximum of 50/.test(error.message))).toBe(true);
    expect(await prisma.assessmentResult.count({ where: { assessmentId: sciencePaperId } })).toBe(0);

    const good = ["Admission no.,Marks (out of 50),Absent,Remark", ...admissions.map((s, i) => `${s.admissionNumber},${i === 0 ? "" : "30"},${i === 0 ? "Yes" : ""},`)].join("\r\n");
    const imported = await importMarksCsv(adminOf(schoolA), sciencePaperId, good);
    expect(imported.errors).toEqual([]);
    expect(imported.saved).toBe(admissions.length);
  });
});

describe("publishing and visibility", () => {
  it("hides exam marks from students and parents until published", async () => {
    const mine = await getMyResults(studentOf(schoolA));
    expect([...mine.past, ...mine.upcoming].some((row) => row.id === mathsPaperId)).toBe(false);
    const child = await getChildResults(parentOf(schoolA), schoolA.studentIds[0]!);
    expect(child.entries.some((row) => row.id === mathsPaperId)).toBe(false);
    expect(await publishedExamsFor(studentOf(schoolA), schoolA.studentIds[0]!)).toEqual([]);
    await expect(getReportCard(parentOf(schoolA), examId, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to publish while marks are missing, and then publishes none of the batch", async () => {
    const { ids } = await createExams(adminOf(schoolA), examInput({ name: "Unit Exam", sectionIds: [schoolA.sectionId] }));
    await expect(publishExams(adminOf(schoolA), [examId, ids[0]!])).rejects.toThrow(/still missing/);
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: examId } })).status).toBe("DRAFT");
    await deleteExam(adminOf(schoolA), ids[0]!);
  });

  it("publishes, then locks marks until the admin unpublishes", async () => {
    // The other section has no students, so it has nothing missing; this one is complete.
    const detail = await getExamDetail(adminOf(schoolA), examId);
    expect(detail.papers.every((paper) => paper.entered === paper.expected)).toBe(true);

    await expect(publishExams(teacherOf(schoolA), [examId])).rejects.toBeInstanceOf(ForbiddenError);
    await publishExams(adminOf(schoolA), [examId]);
    await expect(
      saveMarks(adminOf(schoolA), mathsPaperId, [{ studentId: schoolA.studentIds[0]!, marks: 10, absent: false, remark: null }]),
    ).rejects.toBeInstanceOf(AppError);
    await expect(deleteExam(adminOf(schoolA), examId)).rejects.toBeInstanceOf(AppError);

    await unpublishExam(adminOf(schoolA), examId);
    expect((await getMarksSheet(adminOf(schoolA), mathsPaperId)).editable).toBe(true);
    await publishExams(adminOf(schoolA), [examId]);
  });

  it("shows the published result and report card to the student and their parent only", async () => {
    const card = await getReportCard(parentOf(schoolA), examId, schoolA.studentIds[0]!);
    // Maths 92/100 + Science absent (0/50): 92/150 = 61.3% → B2, but absent fails the exam.
    expect(card.total).toBe(92);
    expect(card.maxTotal).toBe(150);
    expect(card.percent).toBe(61.3);
    expect(card.grade).toBe("B2");
    expect(card.outcome).toBe("FAIL");
    expect(card.subjects.find((row) => row.subject === "Mathematics")?.remark).toBe("Excellent");

    const mine = await publishedExamsFor(studentOf(schoolA), schoolA.studentIds[0]!);
    expect(mine.map((exam) => exam.id)).toEqual([examId]);
    expect((await getMyResults(studentOf(schoolA))).past.some((row) => row.id === mathsPaperId)).toBe(true);

    // A classmate's report card is not the student's to open.
    await expect(getReportCard(studentOf(schoolA), examId, schoolA.studentIds[1]!)).rejects.toBeInstanceOf(NotFoundError);
    // Another school's parent, admin or student: nothing.
    await expect(getReportCard(parentOf(schoolB), examId, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getReportCard(adminOf(schoolB), examId, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    // Teachers do not open report cards.
    await expect(getReportCard(teacherOf(schoolA), examId, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("class tests", () => {
  it("lets a teacher set one for their own subject, visible as soon as it is marked", async () => {
    const teacher = teacherOf(schoolA);
    await expect(
      createClassTest(teacher, { sectionId: schoolA.sectionId, subjectId: scienceId, name: "Quiz", date: today(), maxMarks: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const { id } = await createClassTest(teacher, {
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      name: "Unit Test 1",
      date: today(),
      maxMarks: 20,
    });
    await saveMarks(teacher, id, [{ studentId: schoolA.studentIds[0]!, marks: 18, absent: false, remark: null }]);
    expect((await getMyResults(studentOf(schoolA))).past.find((row) => row.id === id)?.marksObtained).toBe(18);
    expect((await listMyPapers(teacher)).papers.some((paper) => paper.id === id && paper.kind === "CLASS_TEST")).toBe(true);
  });
});
