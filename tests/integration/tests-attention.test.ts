/**
 * Exams & Tests made simple: a teacher sets tests only for what they are
 * assigned (subject, section, stream), enters marks as a draft, submits them
 * (then they lock), and families see results only once submitted. Plus the
 * Needs Attention rule, which must say why and follow the school's threshold.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { needsAttention, saveAttentionSettings } from "@/server/exams/attention";
import { myMeetings } from "@/server/communication/meetings";
import { createSupport, familySupport, followUpSupport, scheduleExtraClass } from "@/server/support/service";
import {
  createClassTest,
  deleteClassTest,
  getMarksSheet,
  listMyTests,
  listTests,
  reopenMarks,
  saveMarks,
  submitMarks,
  testCounts,
  updateClassTest,
} from "@/server/exams/service";
import { prisma } from "@/server/db/prisma";
import { getChildResults } from "@/server/parent/child";
import { getMyResults } from "@/server/student/me";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let physicsId: string;
let scienceId: string;
let otherTeacher: ReturnType<typeof contextFor>;
let otherTeacherId: string;

const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");
const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const allMarked = (school: SeededSchool, first: number, rest: number | null = null) => [
  { studentId: school.studentIds[0]!, marks: first, absent: false, remark: null },
  ...school.studentIds.slice(1).map((studentId) => ({ studentId, marks: rest, absent: rest === null, remark: null })),
];

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  physicsId = (await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "Physics", code: "PHY-T" } })).id;
  scienceId = (await prisma.stream.create({ data: { schoolId: schoolA.schoolId, name: "Science (tests)" } })).id;
  // The first student is in the Science stream of the shared section.
  await prisma.studentEnrollment.updateMany({ where: { schoolId: schoolA.schoolId, studentId: schoolA.studentIds[0]! }, data: { streamId: scienceId } });
  const user = await prisma.user.create({
    data: { email: "physics@iso-test-a.test", passwordHash: "x", role: "TEACHER", firstName: "Phy", lastName: "Teacher", schoolId: schoolA.schoolId },
  });
  otherTeacherId = (await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "PHY1", firstName: "Phy", lastName: "Teacher" } })).id;
  await prisma.teacherSubjectAssignment.create({
    data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, teacherId: otherTeacherId, subjectId: physicsId, sectionId: schoolA.sectionId, streamId: scienceId },
  });
  otherTeacher = contextFor(schoolA, user.id, "TEACHER");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("creating tests: only what the teacher is assigned", () => {
  it("refuses another subject, another stream, or the whole section for a stream-only teacher", async () => {
    const base = { name: "Quiz", date: today(), maxMarks: 10 };
    // Teacher A teaches the fixture subject, not Physics.
    await expect(createClassTest(teacherOf(schoolA), { ...base, sectionId: schoolA.sectionId, subjectId: physicsId })).rejects.toBeInstanceOf(ForbiddenError);
    // Teacher A is not assigned the unassigned section.
    await expect(createClassTest(teacherOf(schoolA), { ...base, sectionId: schoolA.unassignedSectionId, subjectId: schoolA.subjectId })).rejects.toBeInstanceOf(ForbiddenError);
    // The Physics teacher teaches the Science stream only — not the whole section.
    await expect(createClassTest(otherTeacher, { ...base, sectionId: schoolA.sectionId, subjectId: physicsId })).rejects.toBeInstanceOf(ForbiddenError);
    // Nor can a teacher reach another school's section.
    await expect(createClassTest(teacherOf(schoolA), { ...base, sectionId: schoolB.sectionId, subjectId: schoolA.subjectId })).rejects.toBeInstanceOf(ForbiddenError);
    // The parent and the admin don't set teachers' tests.
    await expect(createClassTest(adminOf(schoolA), { ...base, sectionId: schoolA.sectionId, subjectId: schoolA.subjectId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a stream test reaches only that stream's students", async () => {
    const { id } = await createClassTest(otherTeacher, { name: "Optics", date: today(), maxMarks: 20, sectionId: schoolA.sectionId, subjectId: physicsId, streamId: scienceId });
    const sheet = await getMarksSheet(otherTeacher, id);
    expect(sheet.rows.map((row) => row.studentId)).toEqual([schoolA.studentIds[0]]);
    expect(sheet.paper.stream).toBe("Science (tests)");
    await saveMarks(otherTeacher, id, [{ studentId: schoolA.studentIds[0]!, marks: 15, absent: false, remark: null }]);
    // A student of another stream is not in this test.
    await expect(saveMarks(otherTeacher, id, [{ studentId: schoolA.studentIds[1]!, marks: 5, absent: false, remark: null }])).rejects.toBeInstanceOf(NotFoundError);
    await submitMarks(otherTeacher, id);
    // Visible to the Science student; never listed for the others.
    expect((await getMyResults(studentOf(schoolA))).past.some((row) => row.id === id)).toBe(true);
    const sibling = await getChildResults(parentOf(schoolA), schoolA.studentIds[1]!);
    expect(sibling.entries.some((row) => row.id === id)).toBe(false);
  });
});

describe("entering marks", () => {
  let testId: string;

  beforeAll(async () => {
    testId = (await createClassTest(teacherOf(schoolA), { name: "Unit Test 3", date: today(), maxMarks: 50, sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, description: "Ch 1-3" })).id;
  });

  it("checks 0 ≤ marks ≤ maximum, and keeps another teacher and another class out", async () => {
    const one = (marks: number) => [{ studentId: schoolA.studentIds[0]!, marks, absent: false, remark: null }];
    await expect(saveMarks(teacherOf(schoolA), testId, one(51))).rejects.toBeInstanceOf(ValidationError);
    await expect(saveMarks(teacherOf(schoolA), testId, one(-1))).rejects.toBeInstanceOf(ValidationError);
    // Another teacher — even one in the same section — cannot touch this test.
    await expect(saveMarks(otherTeacher, testId, one(40))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMarksSheet(otherTeacher, testId)).rejects.toBeInstanceOf(ForbiddenError);
    // Another school's admin cannot see it at all.
    await expect(getMarksSheet(adminOf(schoolB), testId)).rejects.toBeInstanceOf(NotFoundError);
    // Students of another school's section are refused.
    await expect(saveMarks(teacherOf(schoolA), testId, [{ studentId: schoolB.studentIds[0]!, marks: 5, absent: false, remark: null }])).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is a private draft until submitted; submitting needs every student and then locks", async () => {
    await saveMarks(teacherOf(schoolA), testId, [{ studentId: schoolA.studentIds[0]!, marks: 18, absent: false, remark: null }]);
    expect((await getMyResults(studentOf(schoolA))).past.some((row) => row.id === testId)).toBe(false);
    expect((await getMarksSheet(teacherOf(schoolA), testId)).stage).toBe("DRAFT");
    // Not everyone has marks yet.
    await expect(submitMarks(teacherOf(schoolA), testId)).rejects.toThrow(/no marks yet/);

    await saveMarks(teacherOf(schoolA), testId, allMarked(schoolA, 18, 30));
    expect(await submitMarks(teacherOf(schoolA), testId)).toEqual({ visibleNow: true });
    const sheet = await getMarksSheet(teacherOf(schoolA), testId);
    expect(sheet).toMatchObject({ editable: false, stage: "PUBLISHED" });
    expect(sheet.rows[0]).toMatchObject({ percent: 36, entry: "ENTERED" });
    expect((await getMyResults(studentOf(schoolA))).past.find((row) => row.id === testId)?.marksObtained).toBe(18);
    expect((await getChildResults(parentOf(schoolA), schoolA.studentIds[0]!)).entries.some((row) => row.id === testId)).toBe(true);

    // Locked for the teacher, and they cannot reopen it themselves.
    await expect(saveMarks(teacherOf(schoolA), testId, allMarked(schoolA, 20, 30))).rejects.toThrow(/locked/);
    await expect(reopenMarks(teacherOf(schoolA), testId, "typo")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateClassTest(teacherOf(schoolA), { assessmentId: testId, name: "x", date: today(), maxMarks: 50, description: null })).rejects.toBeInstanceOf(AppError);

    // The office reopens for a correction — hidden from families again until resubmitted.
    await reopenMarks(adminOf(schoolA), testId, "Wrong marks for roll 1");
    expect((await getMyResults(studentOf(schoolA))).past.some((row) => row.id === testId)).toBe(false);
    await saveMarks(teacherOf(schoolA), testId, allMarked(schoolA, 20, 30));
    await submitMarks(teacherOf(schoolA), testId);
    expect(await prisma.auditLog.count({ where: { schoolId: schoolA.schoolId, action: "MARKS_REOPENED", entityId: testId } })).toBe(1);
  });

  it("edits and deletes a test only while that is safe", async () => {
    const { id } = await createClassTest(teacherOf(schoolA), { name: "Spot quiz", date: today(), maxMarks: 20, sectionId: schoolA.sectionId, subjectId: schoolA.subjectId });
    await saveMarks(teacherOf(schoolA), id, [{ studentId: schoolA.studentIds[0]!, marks: 15, absent: false, remark: null }]);
    // The maximum cannot drop below a mark already given.
    await expect(updateClassTest(teacherOf(schoolA), { assessmentId: id, name: "Spot quiz", date: today(), maxMarks: 10, description: null })).rejects.toBeInstanceOf(ValidationError);
    await updateClassTest(teacherOf(schoolA), { assessmentId: id, name: "Spot quiz 1", date: today(), maxMarks: 25, description: "Renamed" });
    // Marks exist, so it is a record now.
    await expect(deleteClassTest(teacherOf(schoolA), id)).rejects.toBeInstanceOf(ConflictError);
    const empty = await createClassTest(teacherOf(schoolA), { name: "Set by mistake", date: today(), maxMarks: 10, sectionId: schoolA.sectionId, subjectId: schoolA.subjectId });
    await expect(deleteClassTest(otherTeacher, empty.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteClassTest(teacherOf(schoolA), empty.id);
    expect(await prisma.assessment.count({ where: { id: empty.id } })).toBe(0);
  });

  it("lists only the teacher's own tests, and gives the admin every one with filters and counts", async () => {
    const mine = await listMyTests(teacherOf(schoolA));
    expect(mine.every((row) => row.subject !== "Physics")).toBe(true);
    const theirs = await listMyTests(otherTeacher);
    expect(theirs.every((row) => row.subject === "Physics")).toBe(true);

    const physics = await listTests(adminOf(schoolA), { subjectId: physicsId });
    expect(physics.length).toBeGreaterThan(0);
    expect(physics.every((row) => row.subject === "Physics")).toBe(true);
    const published = await listTests(adminOf(schoolA), { view: "published" });
    expect(published.every((row) => row.stage === "PUBLISHED")).toBe(true);
    const pending = await listTests(adminOf(schoolA), { view: "pending" });
    expect(pending.every((row) => row.stage === "DRAFT" || row.stage === "ENTER_MARKS")).toBe(true);
    expect((await testCounts(adminOf(schoolA))).published).toBe(published.length);
    // Another school sees none of these.
    expect((await listTests(adminOf(schoolB))).some((row) => physics.some((other) => other.id === row.id))).toBe(false);
    await expect(listTests(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Needs Attention", () => {
  it("flags the latest result below the threshold, says why, and follows the school's setting", async () => {
    const student = schoolA.studentIds[0]!;
    // Teacher A's submitted tests so far: student 0 had 18/50 then 20/50 = 40%.
    const flagged = await needsAttention(adminOf(schoolA), { studentIds: [student], subjectId: schoolA.subjectId });
    const row = flagged.rows.find((item) => item.subjectId === schoolA.subjectId);
    // 40% is not *below* 40%.
    expect(row).toBeUndefined();

    await saveAttentionSettings(adminOf(schoolA), { percent: 45, repeat: 2 });
    const after = (await needsAttention(adminOf(schoolA), { studentIds: [student], subjectId: schoolA.subjectId })).rows[0]!;
    expect(after.reasons.map((reason) => reason.code)).toContain("LATEST");
    expect(after.reasons.find((reason) => reason.code === "LATEST")!.text).toMatch(/below the 45% threshold/);
    expect(after.latestPercent).toBe(40);
    // Others in the class scored 60% — not flagged.
    const others = await needsAttention(adminOf(schoolA), { studentIds: schoolA.studentIds.slice(1), subjectId: schoolA.subjectId });
    expect(others.rows).toHaveLength(0);
    await expect(saveAttentionSettings(teacherOf(schoolA), { percent: 10, repeat: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveAttentionSettings(adminOf(schoolA), { percent: 0, repeat: 2 })).rejects.toBeInstanceOf(AppError);
  });

  it("counts repeated low results, and teacher support as a reason of its own", async () => {
    const student = schoolA.studentIds[0]!;
    const make = async (name: string, marks: number) => {
      const { id } = await createClassTest(teacherOf(schoolA), { name, date: today(), maxMarks: 100, sectionId: schoolA.sectionId, subjectId: schoolA.subjectId });
      await saveMarks(teacherOf(schoolA), id, allMarked(schoolA, marks, 80));
      await submitMarks(teacherOf(schoolA), id);
    };
    await make("Weekly 1", 30);
    await make("Weekly 2", 90);
    const row = (await needsAttention(adminOf(schoolA), { studentIds: [student], subjectId: schoolA.subjectId })).rows[0];
    // Latest is 90%, but two of the last three (40%, 30%) are below 45%.
    expect(row?.reasons.map((reason) => reason.code)).toEqual(["REPEATED"]);

    const support = await prisma.studentSupport.create({
      data: {
        schoolId: schoolA.schoolId,
        academicSessionId: schoolA.academicSessionId,
        studentId: schoolA.studentIds[1]!,
        classId: schoolA.classId,
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        teacherId: schoolA.teacherId,
        source: "TEACHER",
        reason: "NEEDS_PRACTICE",
        action: "EXTRA_PRACTICE",
        status: "IN_PROGRESS",
      },
    });
    const supported = (await needsAttention(adminOf(schoolA), { studentIds: [schoolA.studentIds[1]!] })).rows[0]!;
    expect(supported.reasons.map((reason) => reason.code)).toEqual(["SUPPORT"]);
    expect(supported.supportId).toBe(support.id);
  });

  it("shows a teacher only their subjects (and their own class), and nothing across schools", async () => {
    // The Physics teacher teaches only Physics: Teacher A's subject is not theirs to see.
    const physicsView = await needsAttention(otherTeacher);
    expect(physicsView.rows.every((row) => row.subjectId === physicsId)).toBe(true);
    // The class teacher sees their section's flags.
    expect((await needsAttention(teacherOf(schoolA))).rows.length).toBeGreaterThan(0);
    // School B's admin sees nothing of School A.
    expect((await needsAttention(adminOf(schoolB))).rows.some((row) => schoolA.studentIds.includes(row.studentId))).toBe(false);
    // Families never see this list.
    expect((await needsAttention(parentOf(schoolA))).rows).toHaveLength(0);
  });
});

describe("support: extra class and the family's view", () => {
  it("lets the subject teacher (not another teacher) record support, book an extra class and share a remark", async () => {
    const student = schoolA.studentIds[2]!;
    // Only the subject's teacher may open subject support; the Physics teacher does not teach this subject.
    await expect(
      createSupport(otherTeacher, { studentId: student, subjectId: schoolA.subjectId, reason: "NEEDS_PRACTICE", action: "EXTRA_CLASS", priority: "MEDIUM", reasonNote: null, topic: "Fractions", actionNote: null, teacherId: null, concernId: null } as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const supportId = await createSupport(teacherOf(schoolA), { studentId: student, subjectId: schoolA.subjectId, reason: "NEEDS_PRACTICE", action: "EXTRA_CLASS", priority: "MEDIUM", reasonNote: null, topic: "Fractions", actionNote: null, teacherId: null, concernId: null } as never);

    // Tomorrow, so it is still upcoming whatever time the suite runs.
    const slot = { supportId, date: addDays(today(), 1), startMinute: 14 * 60, endMinute: 14 * 60 + 45, location: "Room 4" };
    await expect(scheduleExtraClass(otherTeacher, slot)).rejects.toBeInstanceOf(NotFoundError);
    await expect(scheduleExtraClass(parentOf(schoolA), slot)).rejects.toBeInstanceOf(ForbiddenError);
    await scheduleExtraClass(teacherOf(schoolA), slot);
    // Only one upcoming extra class at a time.
    await expect(scheduleExtraClass(teacherOf(schoolA), slot)).rejects.toBeInstanceOf(ConflictError);

    // The family and the teacher see the class under Meetings.
    const forParent = await myMeetings(parentOf(schoolA));
    expect(forParent.upcoming.some((meeting) => meeting.title.startsWith("Extra class"))).toBe(true);
    expect((await myMeetings(teacherOf(schoolA))).upcoming.some((meeting) => meeting.title.startsWith("Extra class"))).toBe(true);
    // Another teacher is not invited.
    expect((await myMeetings(otherTeacher)).upcoming.some((meeting) => meeting.title.startsWith("Extra class"))).toBe(false);

    // A remark shared with the parent, then completion.
    await followUpSupport(teacherOf(schoolA), { supportId, note: null, parentRemark: "Ten minutes of fractions practice daily will help." });
    const family = await familySupport(parentOf(schoolA));
    const row = family.supports.find((item) => item.id === supportId)!;
    expect(row.parentRemark).toMatch(/fractions practice/);
    expect(row.extraClass).not.toBeNull();
    await followUpSupport(teacherOf(schoolA), { supportId, note: "Support completed.", status: "RESOLVED" });
    expect((await prisma.studentSupport.findUniqueOrThrow({ where: { id: supportId } })).status).toBe("RESOLVED");
    await expect(scheduleExtraClass(teacherOf(schoolA), { ...slot, startMinute: 15 * 60, endMinute: 15 * 60 + 30 })).rejects.toBeInstanceOf(ConflictError);
  });
});
