/**
 * The school calendar (events, exams, PTMs) and the academic and workload
 * reports: each shows only what the viewer is entitled to, inside one school.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { ForbiddenError } from "@/lib/errors";
import { eventSchema as communicationEventSchema } from "@/lib/validation/communication";
import { createExamSchema } from "@/lib/validation/exams";
import { getCalendarEntries } from "@/server/calendar/entries";
import { saveEvent } from "@/server/communication/events";
import { prisma } from "@/server/db/prisma";
import { createExams, publishExams, saveMarks } from "@/server/exams/service";
import { examPerformanceReport, teacherWorkloadReport } from "@/server/reports/exports";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");
const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await saveEvent(adminOf(schoolA), communicationEventSchema.parse({ title: "Sports Day", date: toDateInput(addDays(today(), 3)), isPublished: "on" }));
  await saveEvent(adminOf(schoolA), communicationEventSchema.parse({ title: "Draft Fair", date: toDateInput(addDays(today(), 4)) }));
  await createExams(
    adminOf(schoolA),
    createExamSchema.parse({
      name: "Unit Exam",
      sectionIds: [schoolA.sectionId],
      startDate: toDateInput(addDays(today(), -2)),
      endDate: toDateInput(addDays(today(), -1)),
      papers: [{ subjectId: schoolA.subjectId, maxMarks: "10" }],
    }),
  );
  await createExams(
    adminOf(schoolA),
    createExamSchema.parse({
      name: "Section B Test",
      sectionIds: [schoolA.unassignedSectionId],
      startDate: toDateInput(addDays(today(), 1)),
      endDate: toDateInput(addDays(today(), 1)),
      papers: [{ subjectId: schoolA.subjectId, maxMarks: "10" }],
    }),
  );
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

const titles = async (ctx: Parameters<typeof getCalendarEntries>[0]) =>
  (await getCalendarEntries(ctx, addDays(today(), -10), addDays(today(), 10))).map((entry) => entry.title);

describe("school calendar", () => {
  it("shows the admin everything, drafts included", async () => {
    const seen = await titles(adminOf(schoolA));
    expect(seen).toEqual(expect.arrayContaining(["Sports Day", "Draft Fair"]));
    expect(seen.some((title) => title.startsWith("Unit Exam"))).toBe(true);
    expect(seen.some((title) => title.startsWith("Section B Test"))).toBe(true);
  });

  it("shows a student and parent published events and their own section's exams only", async () => {
    for (const ctx of [studentOf(schoolA), parentOf(schoolA)]) {
      const seen = await titles(ctx);
      expect(seen).toContain("Sports Day");
      expect(seen).not.toContain("Draft Fair");
      expect(seen).toContain("Unit Exam");
      expect(seen).not.toContain("Section B Test");
    }
  });

  it("shows a teacher their sections' exams, and nothing crosses schools", async () => {
    const teacher = await titles(teacherOf(schoolA));
    expect(teacher).toContain("Unit Exam");
    expect(teacher).not.toContain("Section B Test");
    for (const ctx of [adminOf(schoolB), studentOf(schoolB), teacherOf(schoolB)]) {
      expect(await titles(ctx)).toEqual([]);
    }
  });
});

describe("academic and workload reports", () => {
  it("reports exam averages and pass rates from the marks", async () => {
    const exam = await prisma.exam.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, name: "Unit Exam" } });
    const paper = await prisma.assessment.findFirstOrThrow({ where: { examId: exam.id } });
    await saveMarks(
      adminOf(schoolA),
      paper.id,
      schoolA.studentIds.map((studentId, index) => ({ studentId, marks: index === 0 ? 2 : 8, absent: false, remark: null })),
    );
    await publishExams(adminOf(schoolA), [exam.id]);
    const { exams } = await examPerformanceReport(adminOf(schoolA));
    const row = exams.find((item) => item.id === exam.id)!;
    expect(row.students).toBe(schoolA.studentIds.length);
    expect(row.passRate).toBeCloseTo((schoolA.studentIds.length - 1) / schoolA.studentIds.length);
    expect((await examPerformanceReport(adminOf(schoolB))).exams).toEqual([]);
  });

  it("reports teacher workload to the School Admin only", async () => {
    const rows = await teacherWorkloadReport(adminOf(schoolA), addDays(today(), -30), today());
    expect(rows.map((row) => row.id)).toContain(schoolA.teacherId);
    expect(rows.map((row) => row.id)).not.toContain(schoolB.teacherId);
    await expect(teacherWorkloadReport(teacherOf(schoolA), addDays(today(), -30), today())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
