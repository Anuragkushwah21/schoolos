/**
 * Academic progress, end to end, from the source records:
 *
 *   * the school's syllabus (units → chapters → topics), edited by leaders,
 *     read by the teacher who teaches that class and subject;
 *   * topics recorded in lessons (timetable-linked), coverage per unit;
 *   * "lesson record missing" kept apart from "not conducted", with evidence;
 *   * homework submission vs teacher review vs tests — separate measures;
 *   * the school's own threshold, reviews without duplicates, revision and a
 *     follow-up test, unit-ready review, unit report and exam readiness;
 *   * who may see and do what — teacher, Principal, School Admin, another school.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DayOfWeek } from "@/generated/prisma/enums";
import { addDays, dayOfWeek, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { academicMonitoring, createReview, examReadiness, leaderReviewCounts, markUnitReady, myReviewsToAnswer, pairProgress, respondToReview, saveAcademicThreshold, unitReport, updateReview } from "@/server/academics/progress";
import { deleteSyllabusItem, getSyllabus, saveSyllabusItem } from "@/server/academics/syllabus";
import { recordActivity } from "@/server/classwork/activities";
import { createHomework, markHomeworkSubmissions } from "@/server/classwork/homework";
import { createClassTest, saveMarks, submitMarks } from "@/server/exams/service";
import { getAdminAlerts, getPrincipalAlerts, getTeacherAlerts } from "@/server/alerts/feeds";
import { getMyHomeworkItem } from "@/server/student/me";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let principalId: string;
const ids = { unit: "", chapter: "", t1: "", t2: "", emptyUnit: "", slots: {} as Record<string, string>, test: "", followUp: "" };
const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const pair = () => ({ sectionId: schoolA.sectionId, subjectId: schoolA.subjectId });
const teacher = () => teacherOf(schoolA);
const admin = () => adminOf(schoolA);
const principal = () => contextFor(schoolA, principalId, "PRINCIPAL");
const slotOn = (date: Date) => ids.slots[dayOfWeek(date)]!;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // Open every day, so the dates below are always teaching days.
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { weeklyOffDays: [] } });
  principalId = (await prisma.user.create({ data: { email: "principal@acp.test", passwordHash: "x", role: "PRINCIPAL", firstName: "Pri", lastName: "Ncipal", schoolId: schoolA.schoolId } })).id;
  // One period a day for the teacher's subject in their section.
  for (const [index, day] of DAYS.entries()) {
    const slot = await prisma.timetableSlot.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, teacherId: schoolA.teacherId, dayOfWeek: day, startMinute: 480 + index, endMinute: 520 + index } });
    ids.slots[day] = slot.id;
  }
}, 60_000);

afterAll(async () => {
  const where = { schoolId: schoolA.schoolId };
  await prisma.academicReview.deleteMany({ where });
  await prisma.lessonTopic.deleteMany({ where });
  await prisma.homework.deleteMany({ where });
  await prisma.assessmentResult.deleteMany({ where });
  await prisma.assessment.deleteMany({ where });
  await prisma.classSession.deleteMany({ where });
  await prisma.timetableSlot.deleteMany({ where });
  await prisma.syllabusItem.deleteMany({ where: { ...where, level: "TOPIC" } });
  await prisma.syllabusItem.deleteMany({ where: { ...where, level: "CHAPTER" } });
  await prisma.syllabusItem.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: principalId } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
}, 60_000);

describe("syllabus", () => {
  it("before it is set up, coverage is 'not configured' — never 0%", async () => {
    const progress = await pairProgress(teacher(), pair());
    expect(progress.syllabus).toMatchObject({ configured: false, percent: null, expected: 0 });
  });

  it("leaders build it; a teacher reads only what they teach; wrong nesting and in-use deletes are refused", async () => {
    const classId = schoolA.classId;
    const subjectId = schoolA.subjectId;
    ids.unit = (await saveSyllabusItem(admin(), { classId, subjectId, level: "UNIT", parentId: null, title: "Unit 1 — Numbers", plannedFrom: addDays(today(), -20), plannedTo: addDays(today(), -1) })).id;
    ids.chapter = (await saveSyllabusItem(principal(), { classId, subjectId, level: "CHAPTER", parentId: ids.unit, title: "Fractions" })).id;
    ids.t1 = (await saveSyllabusItem(admin(), { classId, subjectId, level: "TOPIC", parentId: ids.chapter, title: "Adding fractions" })).id;
    ids.t2 = (await saveSyllabusItem(admin(), { classId, subjectId, level: "TOPIC", parentId: ids.chapter, title: "Subtracting fractions" })).id;
    ids.emptyUnit = (await saveSyllabusItem(admin(), { classId, subjectId, level: "UNIT", parentId: null, title: "Unit 2 — Shapes" })).id;

    const tree = await getSyllabus(teacher(), { classId, subjectId });
    expect(tree.map((unit) => unit.title)).toEqual(["Unit 1 — Numbers", "Unit 2 — Shapes"]);
    expect(tree[0]!.chapters[0]!.topics.map((topic) => topic.title)).toEqual(["Adding fractions", "Subtracting fractions"]);

    await expect(saveSyllabusItem(teacher(), { classId, subjectId, level: "UNIT", parentId: null, title: "Teacher's own" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSyllabus(teacher(), { classId, subjectId: schoolB.subjectId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveSyllabusItem(admin(), { classId, subjectId, level: "TOPIC", parentId: ids.unit, title: "Topic in a unit" })).rejects.toBeInstanceOf(AppError);
    // Another school sees nothing of it.
    expect(await getSyllabus(adminOf(schoolB), { classId, subjectId })).toEqual([]);
    await expect(deleteSyllabusItem(admin(), ids.chapter)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("lessons and coverage", () => {
  it("topics recorded in a lesson give unit coverage; a past planned end with topics left is 'behind'", async () => {
    const day = addDays(today(), -2);
    await recordActivity(teacher(), { timetableSlotId: slotOn(day), date: day, status: "COMPLETED", topic: "Fractions", notes: null, importantPoints: null, topics: [{ topicId: ids.t1, coverage: "COVERED" }, { topicId: ids.t2, coverage: "PARTIAL" }] });
    const unit = (await pairProgress(teacher(), pair())).syllabus.units.find((row) => row.id === ids.unit)!;
    expect(unit).toMatchObject({ expected: 2, covered: 1, partial: 1, percent: 50, behind: true });
    // A unit with no topics yet has no percentage.
    expect((await pairProgress(teacher(), pair())).syllabus.units.find((row) => row.id === ids.emptyUnit)).toMatchObject({ expected: 0, percent: null, behind: false });
  });

  it("refuses topics from another syllabus, and topics for a class that did not take place", async () => {
    const day = addDays(today(), -3);
    const other = await prisma.syllabusItem.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, classId: schoolA.classId, subjectId: (await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "ACP Other", code: "ACPO" } })).id, level: "TOPIC", title: "Elsewhere" } });
    await expect(recordActivity(teacher(), { timetableSlotId: slotOn(day), date: day, status: "COMPLETED", topic: null, notes: null, importantPoints: null, topics: [{ topicId: other.id, coverage: "COVERED" }] })).rejects.toBeInstanceOf(AppError);
    await expect(recordActivity(teacher(), { timetableSlotId: slotOn(day), date: day, status: "MISSED", topic: null, notes: null, importantPoints: null, topics: [{ topicId: ids.t1, coverage: "COVERED" }] })).rejects.toThrow(/class that took place/);
    await prisma.syllabusItem.delete({ where: { id: other.id } });
    await prisma.subject.deleteMany({ where: { schoolId: schoolA.schoolId, code: "ACPO" } });
  });

  it("no record is 'lesson record missing' with evidence beside it; a record of 'missed' is 'not conducted'", async () => {
    const quiet = addDays(today(), -4);
    let progress = await pairProgress(principal(), pair(), { from: addDays(today(), -6), to: today() });
    const missing = progress.lessons.missingRecords.find((row) => row.date.getTime() === quiet.getTime());
    expect(missing).toMatchObject({ teacherAttendance: null, registerSubmitted: false });
    expect(progress.lessons.notConducted).toBe(0);
    await recordActivity(teacher(), { timetableSlotId: slotOn(quiet), date: quiet, status: "MISSED", topic: null, notes: null, importantPoints: null });
    progress = await pairProgress(principal(), pair(), { from: addDays(today(), -6), to: today() });
    expect(progress.lessons.missingRecords.some((row) => row.date.getTime() === quiet.getTime())).toBe(false);
    expect(progress.lessons.notConducted).toBe(1);
    expect(progress.lessons.withPartialTopics).toBe(1);
  });
});

describe("homework and tests — separate measures", () => {
  it("homework submission and teacher review are counted apart, per class and per unit", async () => {
    const [s1, s2, s3] = schoolA.studentIds as [string, string, string];
    const { id } = await createHomework(teacher(), { sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, title: "ACP fractions sheet", description: null, assignedOn: addDays(today(), -3), dueOn: addDays(today(), -1), status: "PUBLISHED", syllabusItemId: ids.t1 });
    await markHomeworkSubmissions(teacher(), id, [{ studentId: s1, status: "SUBMITTED" }, { studentId: s2, status: "LATE" }]);
    let progress = await pairProgress(teacher(), pair());
    expect(progress.homework).toMatchObject({ due: 1, expected: 3, submitted: 1, late: 1, unchecked: 1, submissionRate: 66.7, reviewRate: 66.7 });
    await markHomeworkSubmissions(teacher(), id, [{ studentId: s3, status: "MISSING" }, { studentId: s1, status: "SUBMITTED", note: "Neat work" }]);
    // The teacher's feedback reaches the student (the first child has a login).
    expect((await getMyHomeworkItem(contextFor(schoolA, schoolA.studentUserId, "STUDENT"), id)).homework).toMatchObject({ submission: "SUBMITTED", feedback: "Neat work" });
    progress = await pairProgress(teacher(), pair());
    expect(progress.homework).toMatchObject({ submissionRate: 66.7, reviewRate: 100, missing: 1 });
    expect(progress.syllabus.units.find((row) => row.id === ids.unit)!.homework).toMatchObject({ assigned: 1, reviewRate: 100 });
    // A syllabus entry from outside the class's syllabus is refused.
    await expect(createHomework(teacher(), { sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, title: "ACP bad link", description: null, assignedOn: today(), dueOn: today(), status: "PUBLISHED", syllabusItemId: "not-a-real-item" })).rejects.toBeInstanceOf(AppError);
  });

  it("a unit with no test shows no assessment data; a submitted test gives participation, average and bands", async () => {
    expect((await pairProgress(teacher(), pair())).syllabus.units.find((row) => row.id === ids.unit)!.assessments).toEqual([]);
    const [s1, s2, s3] = schoolA.studentIds as [string, string, string];
    ids.test = (await createClassTest(teacher(), { sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, name: "ACP Unit 1 test", date: addDays(today(), -2), maxMarks: 20, syllabusItemId: ids.t1 })).id;
    await saveMarks(teacher(), ids.test, [{ studentId: s1, marks: 6, absent: false, remark: null }, { studentId: s2, marks: 10, absent: false, remark: null }, { studentId: s3, marks: null, absent: true, remark: null }]);
    // Draft marks are not counted.
    expect((await pairProgress(teacher(), pair())).assessments).toEqual([]);
    await submitMarks(teacher(), ids.test);
    const stat = (await pairProgress(teacher(), pair())).assessments.find((row) => row.id === ids.test)!;
    expect(stat).toMatchObject({ roster: 3, sat: 2, absent: 1, averagePercent: 40, belowThreshold: true, unitId: ids.unit, itemLevel: "TOPIC" });
    expect(stat.bands).toEqual([1, 1, 0, 0]);
  });

  it("the threshold is the school's own: changing it changes the flag; only the School Admin sets it", async () => {
    await saveAcademicThreshold(admin(), 30);
    expect((await pairProgress(teacher(), pair())).assessments.find((row) => row.id === ids.test)!.belowThreshold).toBe(false);
    await expect(saveAcademicThreshold(principal(), 50)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveAcademicThreshold(admin(), 0)).rejects.toBeInstanceOf(AppError);
    await saveAcademicThreshold(admin(), 60);
    expect((await leaderReviewCounts(principal())).lowUnreviewed).toBeGreaterThanOrEqual(1);
  });
});

describe("reviews and revision", () => {
  it("a low test is raised once; the teacher plans and records the revision and a follow-up test; readiness compares them", async () => {
    const { id } = await createReview(principal(), { ...pair(), assessmentId: ids.test, note: "Revise adding fractions", action: "REVISION_RECOMMENDED" });
    const again = await createReview(principal(), { ...pair(), assessmentId: ids.test, note: "Still needed", action: "REVISION_RECOMMENDED" });
    expect(again.id).toBe(id);
    expect(await prisma.academicReview.count({ where: { assessmentId: ids.test } })).toBe(1);
    expect((await pairProgress(principal(), pair())).assessments.find((row) => row.id === ids.test)!.reviewId).toBe(id);
    expect((await myReviewsToAnswer(teacher())).map((row) => row.id)).toContain(id);
    // One alert for the teacher, keyed by the review — not repeated per page view.
    const alerts = (await getTeacherAlerts(teacher())).filter((row) => row.kind === "academic-review");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.href).toBe(`/teacher/progress/class?section=${schoolA.sectionId}&subject=${schoolA.subjectId}`);
    await expect(createReview(teacher(), { ...pair(), assessmentId: ids.test, note: null, action: "NOTE" })).rejects.toBeInstanceOf(ForbiddenError);

    await respondToReview(teacher(), id, { response: "Revision on Friday", revisionPlannedOn: today() });
    expect((await prisma.academicReview.findUniqueOrThrow({ where: { id } })).status).toBe("REVISION_PLANNED");
    // The revision lesson: one of their recorded lessons for this class, after the test.
    const day = addDays(today(), -1);
    const lesson = await recordActivity(teacher(), { timetableSlotId: slotOn(day), date: day, status: "COMPLETED", topic: "Revision", notes: null, importantPoints: null, topics: [{ topicId: ids.t1, coverage: "COVERED" }] });
    const [s1, s2, s3] = schoolA.studentIds as [string, string, string];
    ids.followUp = (await createClassTest(teacher(), { sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, name: "ACP follow-up", date: today(), maxMarks: 20, syllabusItemId: ids.t1 })).id;
    await saveMarks(teacher(), ids.followUp, [{ studentId: s1, marks: 14, absent: false, remark: null }, { studentId: s2, marks: 16, absent: false, remark: null }, { studentId: s3, marks: 12, absent: false, remark: null }]);
    await submitMarks(teacher(), ids.followUp);
    await respondToReview(teacher(), id, { response: "Revised and re-tested", revisionSessionId: lesson.id, followUpAssessmentId: ids.followUp });
    expect((await prisma.academicReview.findUniqueOrThrow({ where: { id } })).status).toBe("REVISION_DONE");
    // The follow-up must come after the original.
    await expect(respondToReview(teacher(), id, { response: null, followUpAssessmentId: ids.test })).rejects.toBeInstanceOf(AppError);
    // Another school's teacher cannot even find it.
    await expect(respondToReview(teacherOf(schoolB), id, { response: "x" })).rejects.toBeInstanceOf(NotFoundError);

    const readiness = await examReadiness(teacher(), { sectionId: schoolA.sectionId });
    const maths = readiness.subjects[0]!;
    expect(maths.revisions.find((row) => row.id === id)).toMatchObject({ originalAverage: 40, followUpAverage: 70 });
    expect(maths.unitsPending.map((row) => row.title)).toEqual(["Unit 1 — Numbers", "Unit 2 — Shapes"]);
    // Evidence only — nothing here declares the class ready.
    expect(Object.keys(maths)).not.toContain("ready");
    await updateReview(principal(), id, { action: "RESOLVED", note: "Improved" });
    await expect(respondToReview(teacher(), id, { response: "late" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("a teacher marks a unit ready once; leaders see it and close it; the unit report shows gaps and pending work", async () => {
    const { id } = await markUnitReady(teacher(), { ...pair(), unitId: ids.unit, note: "All topics taught" });
    await expect(markUnitReady(teacher(), { ...pair(), unitId: ids.unit, note: null })).rejects.toBeInstanceOf(ConflictError);
    expect((await leaderReviewCounts(admin())).readyUnits).toBe(1);
    expect((await getAdminAlerts(admin())).find((row) => row.kind === "units-ready")?.title).toMatch(/Units ready for review: 1/);
    expect((await getPrincipalAlerts(principal())).some((row) => row.kind === "units-ready")).toBe(true);
    const monitoring = await academicMonitoring(principal(), { from: addDays(today(), -6), to: today() });
    expect(monitoring.readyUnits.map((row) => row.review.id)).toContain(id);
    expect(monitoring.behindUnits.map((row) => row.unit.id)).toContain(ids.unit);

    const report = await unitReport(principal(), pair(), ids.unit);
    expect(report.unit).toMatchObject({ expected: 2, covered: 1, partial: 1 });
    expect(report.gaps.find((row) => row.topic.id === ids.t2)?.reasons).toContain("Only partly covered");
    expect(report.gaps.find((row) => row.topic.id === ids.t1)?.reasons.join(" ")).toMatch(/Below 60%/);
    expect(report.lessonsTeachingUnit).toBe(2);
    await updateReview(principal(), id, { action: "RESOLVED", note: "Reviewed" });
    expect((await leaderReviewCounts(admin())).readyUnits).toBe(0);
  });
});

describe("who may see what", () => {
  it("a teacher is refused other classes and the school-wide view; another school sees none of this", async () => {
    await expect(pairProgress(teacher(), { sectionId: schoolA.unassignedSectionId, subjectId: schoolA.subjectId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(academicMonitoring(teacher(), { from: today(), to: today() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(examReadiness(teacher(), { sectionId: schoolA.unassignedSectionId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markUnitReady(principal(), { ...pair(), unitId: ids.unit, note: null })).rejects.toBeInstanceOf(ForbiddenError);
    // School B's leaders: school A's class is not in their school.
    await expect(pairProgress(adminOf(schoolB), pair())).rejects.toBeInstanceOf(NotFoundError);
    const theirs = await academicMonitoring(adminOf(schoolB), { from: addDays(today(), -6), to: today() });
    expect(theirs.rows.some((row) => row.pair.sectionId === schoolA.sectionId)).toBe(false);
    // Students and parents have no access to the leaders' view.
    await expect(academicMonitoring(contextFor(schoolA, schoolA.parentUserId, "PARENT"), { from: today(), to: today() })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
