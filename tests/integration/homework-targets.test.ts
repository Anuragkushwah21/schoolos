/**
 * Who homework is for, and who handed it in.
 *
 *   * Whole class (as before), several classes in one save (each its own
 *     homework), or selected students only.
 *   * The teacher must teach the subject to every chosen class; chosen
 *     students must be placed there — never another class's, never another
 *     school's.
 *   * Students and parents see only homework that is for them (lists, the
 *     item page, parent alerts).
 *   * The teacher who set it records submitted / late / missing; opening it
 *     never marks anything; missing only once it is due.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { homeworkSchema } from "@/lib/validation/classwork";
import { prisma } from "@/server/db/prisma";
import { createHomework, homeworkRoster, listMyHomework, markHomeworkSubmissions, updateHomework } from "@/server/classwork/homework";
import { getParentAlerts } from "@/server/parent/alerts";
import { getChildHomework } from "@/server/parent/child";
import { getMyHomework, getMyHomeworkItem } from "@/server/student/me";

import { contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let sectionC: string;
let studentC: string;

const base = () => ({ subjectId: schoolA.subjectId, description: null, instructions: "Exercise 4.2", assignedOn: today(), dueOn: addDays(today(), 1), status: "PUBLISHED" as const });
const teacher = () => teacherOf(schoolA);
const student = () => contextFor(schoolA, schoolA.studentUserId, "STUDENT");
const parent = () => contextFor(schoolA, schoolA.parentUserId, "PARENT");
const seenBy = async (homeworkId: string) => {
  const mine = await getMyHomework(student());
  return [...mine.overdue, ...mine.dueToday, ...mine.dueSoon, ...mine.upcoming, ...mine.past].some((row) => row.id === homeworkId);
};
const seenForChild = async (childId: string, homeworkId: string) => {
  const view = await getChildHomework(parent(), childId);
  return [...view.overdue, ...view.dueToday, ...view.dueSoon, ...view.upcoming, ...view.past].some((row) => row.id === homeworkId);
};

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // A second class this teacher teaches Mathematics to, with one student.
  const section = await prisma.section.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, classId: schoolA.classId, name: "HWT-C" } });
  sectionC = section.id;
  await prisma.teacherSubjectAssignment.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, teacherId: schoolA.teacherId, subjectId: schoolA.subjectId, sectionId: sectionC } });
  const pupil = await prisma.student.create({ data: { schoolId: schoolA.schoolId, admissionNumber: "HWT-C1", firstName: "Chitra", lastName: "C", gender: "FEMALE" } });
  studentC = pupil.id;
  await prisma.studentEnrollment.create({ data: { schoolId: schoolA.schoolId, studentId: studentC, academicSessionId: schoolA.academicSessionId, classId: schoolA.classId, sectionId: sectionC, rollNumber: "1" } });
}, 60_000);

afterAll(async () => {
  await prisma.homework.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.studentEnrollment.deleteMany({ where: { studentId: studentC } });
  await prisma.teacherSubjectAssignment.deleteMany({ where: { sectionId: sectionC } });
  await prisma.student.deleteMany({ where: { id: studentC } });
  await prisma.section.deleteMany({ where: { id: sectionC } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("who homework is for", () => {
  it("whole class: every student in the section and their parent see it", async () => {
    const { id, ids } = await createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT whole class" });
    expect(ids).toEqual([id]);
    expect(await prisma.homework.findUniqueOrThrow({ where: { id } })).toMatchObject({ audience: "SECTION" });
    expect(await seenBy(id)).toBe(true);
    for (const childId of schoolA.studentIds) expect(await seenForChild(childId, id)).toBe(true);
    expect((await homeworkRoster(teacher(), id)).counts.total).toBe(schoolA.studentIds.length);
  });

  it("selected students: only they and their parents see it — in lists, the item page and alerts", async () => {
    const [own, chosen] = schoolA.studentIds as [string, string];
    const { id } = await createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT selected", audience: "SELECTED_STUDENTS", studentIds: [chosen] });
    expect(await prisma.homeworkStudent.findMany({ where: { homeworkId: id }, select: { studentId: true } })).toEqual([{ studentId: chosen }]);
    // The signed-in student (the first child) is not chosen: not in the list, and the item is "not found".
    expect(await seenBy(id)).toBe(false);
    await expect(getMyHomeworkItem(student(), id)).rejects.toBeInstanceOf(NotFoundError);
    // The parent sees it for the chosen child only.
    expect(await seenForChild(chosen, id)).toBe(true);
    expect(await seenForChild(own, id)).toBe(false);
    const alerts = (await getParentAlerts(parent())).filter((alert) => alert.title.includes("HWT selected"));
    expect(alerts.map((alert) => alert.childId)).toEqual([chosen]);
    // The teacher's list and roster say who it is for.
    expect((await listMyHomework(teacher())).find((row) => row.id === id)).toMatchObject({ audience: "SELECTED_STUDENTS", studentCount: 1 });
    expect((await homeworkRoster(teacher(), id)).students.map((row) => row.studentId)).toEqual([chosen]);
  });

  it("several classes in one save: one homework per class, with the chosen students split between them", async () => {
    const { ids } = await createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, extraSectionIds: [sectionC], title: "HWT two classes" });
    expect(ids).toHaveLength(2);
    const rows = await prisma.homework.findMany({ where: { id: { in: ids } }, select: { sectionId: true, audience: true } });
    expect(rows.map((row) => row.sectionId).sort()).toEqual([schoolA.sectionId, sectionC].sort());

    const picked = await createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, extraSectionIds: [sectionC], title: "HWT two classes picked", audience: "SELECTED_STUDENTS", studentIds: [schoolA.studentIds[1]!, studentC] });
    const targets = await prisma.homeworkStudent.findMany({ where: { homeworkId: { in: picked.ids } }, select: { studentId: true, homework: { select: { sectionId: true } } } });
    expect(targets.map((row) => [row.homework.sectionId, row.studentId]).sort()).toEqual([[schoolA.sectionId, schoolA.studentIds[1]], [sectionC, studentC]].sort());
    // A class with no chosen student is refused, and nothing is saved.
    const before = await prisma.homework.count({ where: { schoolId: schoolA.schoolId } });
    await expect(createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, extraSectionIds: [sectionC], title: "HWT none in C", audience: "SELECTED_STUDENTS", studentIds: [schoolA.studentIds[1]!] })).rejects.toThrow(/No student chosen in/);
    expect(await prisma.homework.count({ where: { schoolId: schoolA.schoolId } })).toBe(before);
  });

  it("refuses classes, subjects and students the teacher may not use — and saves nothing", async () => {
    const before = await prisma.homework.count({ where: { schoolId: schoolA.schoolId } });
    // A class the teacher does not teach, even alongside one they do.
    await expect(createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, extraSectionIds: [schoolA.unassignedSectionId], title: "HWT bad class" })).rejects.toBeInstanceOf(ForbiddenError);
    // A subject from another school.
    await expect(createHomework(teacher(), { ...base(), subjectId: schoolB.subjectId, sectionId: schoolA.sectionId, title: "HWT bad subject" })).rejects.toBeInstanceOf(ForbiddenError);
    // A student from another class (not chosen) and from another school.
    await expect(createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT other class student", audience: "SELECTED_STUDENTS", studentIds: [schoolA.studentIds[0]!, studentC] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT other school student", audience: "SELECTED_STUDENTS", studentIds: [schoolA.studentIds[0]!, schoolB.studentIds[0]!] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT nobody", audience: "SELECTED_STUDENTS", studentIds: [] })).rejects.toBeInstanceOf(AppError);
    // Another school's teacher cannot set work for this school's class.
    await expect(createHomework(teacherOf(schoolB), { ...base(), subjectId: schoolB.subjectId, sectionId: schoolA.sectionId, title: "HWT cross school" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.homework.count({ where: { schoolId: schoolA.schoolId } })).toBe(before);
    // The form asks for students when "Selected students" is chosen.
    expect(homeworkSchema.safeParse({ sectionId: "s", subjectId: "x", title: "t", assignedOn: "2026-10-13", dueOn: "2026-10-14", status: "PUBLISHED", audience: "SELECTED_STUDENTS" }).success).toBe(false);
  });

  it("editing replaces the chosen students, and switching to the whole class shows it to everyone", async () => {
    const [own, chosen, third] = schoolA.studentIds as [string, string, string];
    const { id } = await createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT edit", audience: "SELECTED_STUDENTS", studentIds: [chosen] });
    await updateHomework(teacher(), id, { ...base(), sectionId: schoolA.sectionId, title: "HWT edit", audience: "SELECTED_STUDENTS", studentIds: [third] });
    expect((await prisma.homeworkStudent.findMany({ where: { homeworkId: id } })).map((row) => row.studentId)).toEqual([third]);
    // An edit that does not mention the audience keeps it as it was.
    await updateHomework(teacher(), id, { ...base(), sectionId: schoolA.sectionId, title: "HWT edit renamed" });
    expect(await prisma.homework.findUniqueOrThrow({ where: { id }, select: { audience: true, title: true } })).toEqual({ audience: "SELECTED_STUDENTS", title: "HWT edit renamed" });
    expect(await seenBy(id)).toBe(false);
    await updateHomework(teacher(), id, { ...base(), sectionId: schoolA.sectionId, title: "HWT edit renamed", audience: "SECTION" });
    expect(await prisma.homeworkStudent.count({ where: { homeworkId: id } })).toBe(0);
    expect(await seenBy(id)).toBe(true);
    expect(await seenForChild(own, id)).toBe(true);
  });
});

describe("who handed it in", () => {
  it("opening homework never marks it; the teacher records submitted, late or missing; students and parents see it", async () => {
    const [own, second] = schoolA.studentIds as [string, string];
    const { id } = await createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT check" });
    await getMyHomeworkItem(student(), id);
    await getChildHomework(parent(), own);
    expect(await prisma.homeworkSubmission.count({ where: { homeworkId: id } })).toBe(0);
    expect((await homeworkRoster(teacher(), id)).counts).toMatchObject({ assigned: 3, submitted: 0 });

    // Not due yet: missing is refused; submitted is fine.
    await expect(markHomeworkSubmissions(teacher(), id, [{ studentId: second, status: "MISSING" }])).rejects.toBeInstanceOf(ConflictError);
    await markHomeworkSubmissions(teacher(), id, [{ studentId: own, status: "SUBMITTED" }, { studentId: second, status: "LATE" }]);
    expect((await getMyHomeworkItem(student(), id)).homework.submission).toBe("SUBMITTED");
    const view = await getChildHomework(parent(), second);
    expect([...view.dueSoon, ...view.dueToday, ...view.upcoming].find((row) => row.id === id)?.submission).toBe("LATE");
    expect((await homeworkRoster(teacher(), id)).counts).toMatchObject({ submitted: 1, late: 1, assigned: 1 });
    // Clearing goes back to just assigned.
    await markHomeworkSubmissions(teacher(), id, [{ studentId: own, status: "ASSIGNED" }]);
    expect((await getMyHomeworkItem(student(), id)).homework.submission).toBeNull();
  });

  it("missing once due; only students it is for; only published work; only the teacher who set it", async () => {
    const [own, chosen] = schoolA.studentIds as [string, string];
    const due = await createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT overdue", assignedOn: addDays(today(), -3), dueOn: addDays(today(), -1), audience: "SELECTED_STUDENTS", studentIds: [chosen] });
    await markHomeworkSubmissions(teacher(), due.id, [{ studentId: chosen, status: "MISSING" }]);
    expect(await prisma.homeworkSubmission.findFirstOrThrow({ where: { homeworkId: due.id } })).toMatchObject({ studentId: chosen, status: "MISSING" });
    // A student it is not for, or from another school.
    await expect(markHomeworkSubmissions(teacher(), due.id, [{ studentId: own, status: "SUBMITTED" }])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markHomeworkSubmissions(teacher(), due.id, [{ studentId: schoolB.studentIds[0]!, status: "SUBMITTED" }])).rejects.toBeInstanceOf(ForbiddenError);
    // Another school's teacher cannot even find it.
    await expect(markHomeworkSubmissions(teacherOf(schoolB), due.id, [{ studentId: chosen, status: "SUBMITTED" }])).rejects.toBeInstanceOf(NotFoundError);
    await expect(homeworkRoster(teacherOf(schoolB), due.id)).rejects.toBeInstanceOf(NotFoundError);
    // A draft cannot be checked.
    const draft = await createHomework(teacher(), { ...base(), sectionId: schoolA.sectionId, title: "HWT draft", status: "DRAFT" });
    await expect(markHomeworkSubmissions(teacher(), draft.id, [{ studentId: own, status: "SUBMITTED" }])).rejects.toThrow(/Publish the homework/);
    // Students and parents never see a draft.
    expect(await seenBy(draft.id)).toBe(false);
    expect(await seenForChild(own, draft.id)).toBe(false);
  });
});
