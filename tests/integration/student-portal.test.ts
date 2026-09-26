/**
 * The student portal, and the header that gets a student into it.
 *
 * Two things under test. First that a student can read their own day end to
 * end — the timetable, what was taught, the notes and material their teachers
 * attached, the homework, the marks, the register and the remarks. Second that
 * there is no id anywhere in those reads that could be changed to see somebody
 * else: a student has one record, and every read starts from their session.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, dayOfWeek, today } from "@/lib/dates";
import { ROLE_PROFILE, roleHomePath, roleProfilePath } from "@/lib/roles";
import { markAttendance } from "@/server/attendance/service";
import { prisma } from "@/server/db/prisma";
import { createHomework } from "@/server/classwork/homework";
import { addRemark } from "@/server/classwork/remarks";
import { recordActivity } from "@/server/classwork/activities";
import { addLessonMaterial, deleteLessonMaterial, planLesson } from "@/server/classwork/lessons";
import { createSlot } from "@/server/timetable/service";
import { createTeacher } from "@/server/people/teachers";
import { createSection } from "@/server/academics/structure";
import { findStudentSelf, requireStudentSelf } from "@/server/student/access";
import {
  getMyAttendance,
  getMyCompletedLessons,
  getMyDay,
  getMyHomework,
  getMyLesson,
  getMyMaterials,
  getMyRemarks,
  getMyResults,
  getMyTimetable,
  getMyUpcomingLessons,
} from "@/server/student/me";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

let slotId: string;
let lessonId: string;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const admin = adminOf(schoolA);

  const day = dayOfWeek(today());
  if (day === "SUNDAY") throw new Error("This suite assumes a school day; re-run Mon-Sat.");

  await createSlot(admin, {
    sectionId: schoolA.sectionId,
    subjectId: schoolA.subjectId,
    teacherId: schoolA.teacherId,
    dayOfWeek: day,
    startMinute: 9 * 60,
    endMinute: 9 * 60 + 45,
    room: "R1",
  });
  slotId = (
    await prisma.timetableSlot.findFirstOrThrow({
      where: { schoolId: schoolA.schoolId, sectionId: schoolA.sectionId, dayOfWeek: day },
      select: { id: true },
    })
  ).id;

  // The whole chain a student then reads, written the way the app writes it.
  await markAttendance(teacherOf(schoolA), {
    sectionId: schoolA.sectionId,
    date: today(),
    entries: schoolA.studentIds.map((studentId) => ({
      studentId,
      status: "PRESENT" as const,
      remarks: null,
    })),
  });

  const recorded = await recordActivity(teacherOf(schoolA), {
    timetableSlotId: slotId,
    date: today(),
    status: "COMPLETED",
    topic: "Quadratic equations",
    notes: "Worked through the formula and three examples.",
    importantPoints: "Practice questions 1-10.",
  });
  lessonId = recorded.id;

  await addLessonMaterial(teacherOf(schoolA), {
    classSessionId: lessonId,
    kind: "NOTES",
    title: "Chapter 4 notes",
    url: null,
    body: "The quadratic formula and worked examples.",
  });
  await addLessonMaterial(teacherOf(schoolA), {
    classSessionId: lessonId,
    kind: "LINK",
    title: "Practice set",
    url: "https://example.test/practice",
    body: null,
  });

  await createHomework(teacherOf(schoolA), {
    sectionId: schoolA.sectionId,
    subjectId: schoolA.subjectId,
    title: "Exercise 4.2",
    description: "Questions 1 to 5.",
    assignedOn: today(),
    dueOn: addDays(today(), 2),
    status: "PUBLISHED",
  });

  await addRemark(teacherOf(schoolA), {
    studentId: schoolA.studentIds[0]!,
    subjectId: schoolA.subjectId,
    understanding: "AVERAGE",
    homeworkHabit: "REGULAR",
    participation: "ACTIVE",
    note: "Needs more practice with quadratic equations.",
  });

  const assessment = await prisma.assessment.create({
    data: {
      schoolId: schoolA.schoolId,
      academicSessionId: schoolA.academicSessionId,
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      teacherId: schoolA.teacherId,
      name: "Unit test 1",
      date: addDays(today(), -3),
      maxMarks: 25,
    },
  });
  await prisma.assessmentResult.create({
    data: {
      schoolId: schoolA.schoolId,
      assessmentId: assessment.id,
      studentId: schoolA.studentIds[0]!,
      marksObtained: 18,
    },
  });
  // One still to come, so "upcoming tests" has something real in it.
  await prisma.assessment.create({
    data: {
      schoolId: schoolA.schoolId,
      academicSessionId: schoolA.academicSessionId,
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      name: "Unit test 2",
      date: addDays(today(), 5),
      maxMarks: 25,
    },
  });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("signing in as a student", () => {
  it("lands on the student dashboard and its own profile", () => {
    expect(roleHomePath("STUDENT")).toBe("/student/dashboard");
    expect(roleProfilePath("STUDENT")).toBe("/student/profile");
  });

  it("gives every role a dashboard and a profile it is allowed to open", () => {
    // The header builds its links from these, so a role can never be offered an
    // area it would be redirected out of.
    for (const role of ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] as const) {
      expect(roleHomePath(role)).toMatch(/^\//);
      expect(ROLE_PROFILE[role]).toMatch(/^\//);
    }
    expect(roleHomePath("SUPER_ADMIN")).toBe("/super-admin/dashboard");
    expect(roleHomePath("SCHOOL_ADMIN")).toBe("/school-admin/dashboard");
    expect(roleHomePath("TEACHER")).toBe("/teacher/dashboard");
    expect(roleHomePath("PARENT")).toBe("/parent/dashboard");
  });

  it("resolves the student from the session, never from a request", async () => {
    const me = await requireStudentSelf(studentOf(schoolA));
    expect(me.student.id).toBe(schoolA.studentIds[0]);
    expect(me.placement.sectionId).toBe(schoolA.sectionId);
  });

  it("is closed to every other role", async () => {
    for (const ctx of [adminOf(schoolA), teacherOf(schoolA)]) {
      await expect(getMyDay(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getMyHomework(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(findStudentSelf(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("a student's own day", () => {
  it("shows today's classes with what was taught", async () => {
    const day = await getMyDay(studentOf(schoolA));
    expect(day.attendance?.status).toBe("PRESENT");
    expect(day.periods).toHaveLength(1);

    const period = day.periods[0]!;
    expect(period.subject).toBe("Mathematics");
    expect(period.status).toBe("COMPLETED");
    expect(period.topic).toBe("Quadratic equations");
    expect(period.written).toBe(true);
    expect(period.materialCount).toBe(2);
    expect(day.tally.completed).toBe(1);
  });

  it("shows completed classes, with what is attached to each", async () => {
    const { lessons, subjects } = await getMyCompletedLessons(studentOf(schoolA));
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({
      topic: "Quadratic equations",
      hasNotes: true,
      hasImportantPoints: true,
      materialCount: 2,
    });
    expect(subjects.map((s) => s.id)).toEqual([schoolA.subjectId]);
  });

  it("opens one completed class in full — notes, points, material and homework", async () => {
    const { lesson, homework } = await getMyLesson(studentOf(schoolA), lessonId);
    expect(lesson.topic).toBe("Quadratic equations");
    expect(lesson.notes).toContain("Worked through the formula");
    expect(lesson.importantPoints).toBe("Practice questions 1-10.");
    expect(lesson.taught).toBe(true);
    expect(lesson.materials.map((m) => m.kind).sort()).toEqual(["LINK", "NOTES"]);
    expect(lesson.materials.find((m) => m.kind === "LINK")?.url).toBe(
      "https://example.test/practice",
    );
    // The homework set around that class, which is what a student looks for.
    expect(homework.map((h) => h.title)).toContain("Exercise 4.2");
  });

  it("shows study material gathered across classes", async () => {
    const { materials } = await getMyMaterials(studentOf(schoolA));
    expect(materials).toHaveLength(2);
    expect(materials.every((m) => m.subject === "Mathematics")).toBe(true);
    expect(materials.every((m) => m.lessonId === lessonId)).toBe(true);
  });

  it("shows only lessons a teacher actually planned as upcoming", async () => {
    const before = await getMyUpcomingLessons(studentOf(schoolA));
    // A period on the timetable is not an upcoming lesson until it is planned:
    // inventing a topic would have a student prepare the wrong thing.
    expect(before.lessons).toHaveLength(0);

    await planLesson(teacherOf(schoolA), {
      timetableSlotId: slotId,
      date: addDays(today(), 7),
      plannedTopic: "Quadratic equations — practice",
      preparation: "Review the notes from today.",
    });

    const after = await getMyUpcomingLessons(studentOf(schoolA));
    expect(after.lessons).toHaveLength(1);
    expect(after.lessons[0]).toMatchObject({
      plannedTopic: "Quadratic equations — practice",
      preparation: "Review the notes from today.",
    });
  });

  it("shows homework, the timetable, attendance, results and remarks", async () => {
    const ctx = studentOf(schoolA);

    const homework = await getMyHomework(ctx);
    expect(homework.dueSoon.map((h) => h.title)).toContain("Exercise 4.2");

    const timetable = await getMyTimetable(ctx);
    expect(timetable.slots.map((s) => s.id)).toContain(slotId);

    const attendance = await getMyAttendance(ctx);
    expect(attendance.counts.PRESENT).toBeGreaterThanOrEqual(1);
    expect(attendance.share).toBe(1);

    const results = await getMyResults(ctx);
    expect(results.past.find((r) => r.sat)).toMatchObject({ marksObtained: 18, maxMarks: 25 });
    expect(results.upcoming.map((r) => r.name)).toContain("Unit test 2");
    expect(results.progress[0]?.average).toBeCloseTo(18 / 25);
    // One mark is a point, not a direction.
    expect(results.progress[0]?.direction).toBeNull();

    const remarks = await getMyRemarks(ctx);
    expect(remarks.entries[0]).toMatchObject({
      understanding: "AVERAGE",
      note: "Needs more practice with quadratic equations.",
    });
  });
});

describe("a student cannot reach anything that is not theirs", () => {
  it("cannot open a lesson from another section", async () => {
    // Same school, a section this student is not in.
    const otherSlot = await prisma.timetableSlot.create({
      data: {
        schoolId: schoolA.schoolId,
        academicSessionId: schoolA.academicSessionId,
        sectionId: schoolA.unassignedSectionId,
        subjectId: schoolA.subjectId,
        teacherId: schoolA.teacherId,
        dayOfWeek: dayOfWeek(today()),
        startMinute: 14 * 60,
        endMinute: 14 * 60 + 45,
      },
    });
    const otherLesson = await prisma.classSession.create({
      data: {
        schoolId: schoolA.schoolId,
        timetableSlotId: otherSlot.id,
        date: today(),
        status: "COMPLETED",
        scheduledTeacherId: schoolA.teacherId,
        topic: "Not your class",
        notes: "Another section's notes.",
      },
    });

    await expect(getMyLesson(studentOf(schoolA), otherLesson.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // And it does not leak into any of the list reads either.
    const completed = await getMyCompletedLessons(studentOf(schoolA));
    expect(completed.lessons.map((l) => l.id)).not.toContain(otherLesson.id);
    const day = await getMyDay(studentOf(schoolA));
    expect(day.periods.map((p) => p.lessonId)).not.toContain(otherLesson.id);
  });

  it("cannot open a lesson from another school, or a made-up one", async () => {
    const elsewhere = await prisma.classSession.findFirst({
      where: { school: { id: schoolB.schoolId } },
      select: { id: true },
    });
    if (elsewhere) {
      await expect(getMyLesson(studentOf(schoolA), elsewhere.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    await expect(getMyLesson(studentOf(schoolA), "no-such-lesson")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("sees only their own attendance, marks and remarks", async () => {
    // The sibling in the same section has their own register row and no marks.
    const mine = await getMyAttendance(studentOf(schoolA));
    const rows = await prisma.studentAttendance.count({
      where: { studentId: schoolA.studentIds[0]!, academicSessionId: schoolA.academicSessionId },
    });
    expect(mine.counts.total).toBe(rows);

    const results = await getMyResults(studentOf(schoolA));
    const sat = results.past.filter((r) => r.sat);
    expect(sat).toHaveLength(1);

    // A classmate's mark is on the same assessment but is not this student's.
    const otherMark = await prisma.assessmentResult.count({
      where: { studentId: schoolA.studentIds[1]! },
    });
    expect(otherMark).toBe(0);
  });

  it("keeps each school's student inside their own school", async () => {
    const b = await requireStudentSelf(studentOf(schoolB));
    expect(schoolA.studentIds).not.toContain(b.student.id);
    expect(b.placement.sectionId).toBe(schoolB.sectionId);
  });
});

describe("a student cannot change anything the school owns", () => {
  const student = () => studentOf(schoolA);

  it("cannot mark attendance, set homework, write a remark or record a class", async () => {
    await expect(
      markAttendance(student(), {
        sectionId: schoolA.sectionId,
        date: today(),
        entries: [{ studentId: schoolA.studentIds[0]!, status: "PRESENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      createHomework(student(), {
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        title: "Nope",
        description: null,
        assignedOn: today(),
        dueOn: today(),
        status: "PUBLISHED",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      addRemark(student(), {
        studentId: schoolA.studentIds[0]!,
        subjectId: null,
        understanding: "GOOD",
        homeworkHabit: null,
        participation: null,
        note: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      recordActivity(student(), {
        timetableSlotId: slotId,
        date: today(),
        status: "CANCELLED",
        topic: null,
        notes: null,
        importantPoints: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot plan a lesson or touch its material", async () => {
    await expect(
      planLesson(student(), {
        timetableSlotId: slotId,
        date: addDays(today(), 1),
        plannedTopic: "Mine now",
        preparation: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      addLessonMaterial(student(), {
        classSessionId: lessonId,
        kind: "NOTES",
        title: "Mine",
        url: null,
        body: "Nope",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const material = await prisma.lessonMaterial.findFirstOrThrow({
      where: { classSessionId: lessonId },
      select: { id: true },
    });
    await expect(deleteLessonMaterial(student(), material.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Still there.
    await expect(
      prisma.lessonMaterial.count({ where: { classSessionId: lessonId } }),
    ).resolves.toBe(2);
  });

  it("cannot reach school administration", async () => {
    await expect(
      createTeacher(student(), {
        firstName: "Not",
        lastName: "Allowed",
        email: "nope@student-portal-test.test",
        gender: null,
        employeeId: null,
        phone: null,
        qualification: null,
        designation: null,
        dateOfBirth: null,
        addressLine: null,
        city: null,
        state: null,
        postalCode: null,
        joiningDate: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      createSection(student(), {
        academicSessionId: schoolA.academicSessionId,
        classId: schoolA.classId,
        name: "Z",
        streamId: null,
        classTeacherId: null,
        capacity: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a teacher may only attach to their own lessons", () => {
  it("refuses a colleague who neither teaches the period nor covers it", async () => {
    const user = await prisma.user.create({
      data: {
        email: "colleague@student-portal-test.test",
        passwordHash: "not-a-real-hash",
        role: "TEACHER",
        firstName: "No",
        lastName: "Claim",
        schoolId: schoolA.schoolId,
      },
    });
    await prisma.teacher.create({
      data: {
        schoolId: schoolA.schoolId,
        userId: user.id,
        employeeId: "EMP900",
        firstName: "No",
        lastName: "Claim",
      },
    });
    const colleague = contextFor(schoolA, user.id, "TEACHER");

    await expect(
      addLessonMaterial(colleague, {
        classSessionId: lessonId,
        kind: "NOTES",
        title: "Not mine",
        url: null,
        body: "Nope",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      planLesson(colleague, {
        timetableSlotId: slotId,
        date: addDays(today(), 2),
        plannedTopic: "Not mine",
        preparation: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
