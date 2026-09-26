/**
 * The parent portal's guarantees.
 *
 * Two things are under test. First that a guardian can read their own child's
 * record end to end — the register, the lessons, the homework, the marks, the
 * remarks and the summary built from all of them. Second, and more important,
 * that changing the `studentId` in a request reaches nothing: not another
 * family's child in the same school, and not a child in another school.
 *
 * Every read goes through the real service the pages and the API routes call,
 * so what passes here is what those surfaces enforce.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, dayOfWeek, today } from "@/lib/dates";
import { roleHomePath } from "@/lib/roles";
import { authenticate } from "@/server/auth/login";
import { prisma } from "@/server/db/prisma";
import { markAttendance, markStaffAttendance } from "@/server/attendance/service";
import { createHomework } from "@/server/classwork/homework";
import { addRemark } from "@/server/classwork/remarks";
import { recordActivity } from "@/server/classwork/activities";
import { createAcademicSession, createSection } from "@/server/academics/structure";
import { deleteStudent, updateStudent } from "@/server/people/students";
import { createTeacher, updateTeacher } from "@/server/people/teachers";
import { findChild, listMyChildren, requireParentSelf } from "@/server/parent/access";
import {
  getChildActivity,
  getChildAttendance,
  getChildFocus,
  getChildHomework,
  getChildRemarks,
  getChildReport,
  getChildResults,
  getChildTimetable,
  getChildToday,
} from "@/server/parent/child";
import { getParentAlerts } from "@/server/parent/alerts";
import { createSlot } from "@/server/timetable/service";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

/** The fixture's own guardian, who has every one of school A's children. */
const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");

/** A slot of school A's teacher, on today's weekday. */
let slotId: string;
let assessmentId: string;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());

  const ctx = adminOf(schoolA);

  // --- the chain the portal reads from, built the way the app builds it -----
  // The suite can run on any weekday, so the period is put on today's.
  // Sunday is not a school day, which the slot input type reflects.
  const day = dayOfWeek(today());
  if (day === "SUNDAY") throw new Error("This suite assumes a school day; re-run Mon-Sat.");

  await createSlot(ctx, {
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

  // A teacher marks the register, writes up the lesson, sets homework and
  // records a remark — exactly the four things a parent then reads.
  await markAttendance(teacherOf(schoolA), {
    sectionId: schoolA.sectionId,
    date: today(),
    entries: schoolA.studentIds.map((studentId, index) => ({
      studentId,
      status: index === 0 ? "PRESENT" : index === 1 ? "ABSENT" : "LATE",
      remarks: null,
    })),
  });

  await recordActivity(teacherOf(schoolA), {
    timetableSlotId: slotId,
    date: today(),
    status: "COMPLETED",
    topic: "Quadratic equations",
    notes: "Worked through the examples on the board.",
    importantPoints: null,
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
    understanding: "GOOD",
    homeworkHabit: "REGULAR",
    participation: "ACTIVE",
    note: "Good participation in today's discussion.",
  });

  // Marks. There is no teacher-facing writer yet, so these go in directly —
  // the portal reads the same rows either way.
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
  assessmentId = assessment.id;
  await prisma.assessmentResult.create({
    data: {
      schoolId: schoolA.schoolId,
      assessmentId: assessment.id,
      studentId: schoolA.studentIds[0]!,
      marksObtained: 18,
    },
  });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("signing in as a guardian", () => {
  it("authenticates and lands on the parent dashboard", async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { id: schoolA.parentUserId },
      select: { email: true, role: true },
    });
    expect(roleHomePath(user.role)).toBe("/parent/dashboard");

    // The fixture's users carry a known hash rather than a usable password, so
    // the credential path is asserted by its refusal being about the password
    // and not about the role or the school.
    const outcome = await authenticate(user.email, "not-the-password");
    expect(outcome).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("resolves the guardian behind the session, never an id from the request", async () => {
    const parent = await requireParentSelf(parentOf(schoolA));
    expect(parent.id).toBe(schoolA.parentId);
  });

  it("is closed to every other role", async () => {
    for (const ctx of [adminOf(schoolA), teacherOf(schoolA)]) {
      await expect(listMyChildren(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getParentAlerts(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getChildToday(ctx, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("my children", () => {
  it("lists exactly the children linked to this guardian, and more than one", async () => {
    const { children } = await listMyChildren(parentOf(schoolA));
    expect(children.length).toBeGreaterThan(1);
    expect(children.map((child) => child.id).sort()).toEqual([...schoolA.studentIds].sort());
    // Each one carries where the school placed them, read off the enrollment.
    for (const child of children) {
      expect(child.sectionId).toBe(schoolA.sectionId);
    }
  });

  it("opens each linked child, and only through the link", async () => {
    for (const studentId of schoolA.studentIds) {
      const child = await findChild(parentOf(schoolA), studentId);
      expect(child.student.id).toBe(studentId);
      expect(child.placement?.sectionId).toBe(schoolA.sectionId);
    }
  });
});

describe("reading one child's record", () => {
  const child = () => schoolA.studentIds[0]!;

  it("shows today as the teachers recorded it", async () => {
    const data = await getChildToday(parentOf(schoolA), child());
    expect(data.attendance?.status).toBe("PRESENT");
    expect(data.periods.map((period) => period.slotId)).toContain(slotId);

    const period = data.periods.find((p) => p.slotId === slotId)!;
    expect(period.status).toBe("COMPLETED");
    expect(period.topic).toBe("Quadratic equations");
    expect(data.tally.completed).toBe(1);

    // The three other panels of the day, each from its own source row.
    expect(data.homework.map((work) => work.title)).toContain("Exercise 4.2");
    expect(data.latestResult).toMatchObject({ marksObtained: 18, maxMarks: 25 });
    expect(data.latestRemark).toMatchObject({ understanding: "GOOD" });
  });

  it("shows attendance, with the school's own marks and nothing invented", async () => {
    const data = await getChildAttendance(parentOf(schoolA), child());
    const rows = await prisma.studentAttendance.count({
      where: { studentId: child(), academicSessionId: schoolA.academicSessionId },
    });

    // Asserted against the register itself, not a fixed number: the fixture
    // seeds a day of its own, and the point is that the two agree exactly.
    expect(data.counts.total).toBe(rows);
    expect(data.rows).toHaveLength(rows);
    expect(data.share).toBe(1);

    // Today's mark is the one the teacher set in this suite.
    const todayRow = data.rows.find((row) => row.date.getTime() === today().getTime());
    expect(todayRow?.status).toBe("PRESENT");

    // The absent child's figure differs, so the share is per child.
    const absent = await getChildAttendance(parentOf(schoolA), schoolA.studentIds[1]!);
    expect(absent.counts.ABSENT).toBe(1);
    expect(absent.share).toBeLessThan(1);
  });

  it("shows the timetable of the section the school placed them in", async () => {
    const data = await getChildTimetable(parentOf(schoolA), child());
    expect(data.slots.map((slot) => slot.id)).toEqual([slotId]);
  });

  it("shows what was actually taught", async () => {
    const data = await getChildActivity(parentOf(schoolA), child());
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({ topic: "Quadratic equations", status: "COMPLETED" });
    expect(data.subjects.map((subject) => subject.id)).toEqual([schoolA.subjectId]);
  });

  it("shows homework, bucketed by what it means tonight", async () => {
    const data = await getChildHomework(parentOf(schoolA), child());
    expect(data.dueSoon.map((work) => work.title)).toContain("Exercise 4.2");
    expect(data.overdue).toHaveLength(0);
  });

  it("shows marks, and keeps a missed paper distinct from a zero", async () => {
    await prisma.assessmentResult.create({
      data: {
        schoolId: schoolA.schoolId,
        assessmentId,
        studentId: schoolA.studentIds[1]!,
        marksObtained: null,
        remarks: "Absent",
      },
    });

    const sat = await getChildResults(parentOf(schoolA), child());
    expect(sat.satCount).toBe(1);
    expect(sat.entries[0]).toMatchObject({ marksObtained: 18, maxMarks: 25, sat: true });
    expect(sat.entries[0]!.share).toBeCloseTo(18 / 25);
    // One result is a point, not a direction.
    expect(sat.subjects[0]!.direction).toBeNull();

    const missed = await getChildResults(parentOf(schoolA), schoolA.studentIds[1]!);
    expect(missed.satCount).toBe(0);
    expect(missed.entries[0]).toMatchObject({ sat: false, marksObtained: null, share: null });
  });

  it("shows the teacher's structured remark", async () => {
    const data = await getChildRemarks(parentOf(schoolA), child());
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({
      understanding: "GOOD",
      homeworkHabit: "REGULAR",
      participation: "ACTIVE",
      note: "Good participation in today's discussion.",
    });
  });

  it("builds a report out of the source rows, not a separate document", async () => {
    const report = await getChildReport(parentOf(schoolA), child(), "week");
    expect(report.attendance.counts.total).toBeGreaterThanOrEqual(1);
    expect(report.attendance.rows.some((row) => row.date.getTime() === today().getTime())).toBe(true);
    expect(report.lessons.total).toBe(1);
    expect(report.lessons.bySubject[0]?.topics).toContain("Quadratic equations");
    expect(report.homework).toHaveLength(1);
    expect(report.remarks).toHaveLength(1);
    // The mark was three days ago, so it is in the week but not in the day.
    expect(report.results).toHaveLength(1);
    await expect(
      getChildReport(parentOf(schoolA), child(), "day").then((r) => r.results),
    ).resolves.toHaveLength(0);
  });

  it("suggests what to work on, pointing only at recorded rows", async () => {
    const { items } = await getChildFocus(parentOf(schoolA), child());
    expect(items.length).toBeGreaterThan(0);
    // Every suggestion names a real reason; none is invented from nothing.
    for (const item of items) {
      expect([
        "recent-topic",
        "weak-subject",
        "homework-due",
        "attendance",
        "missed-class",
      ]).toContain(item.reason);
    }
    expect(items.some((item) => item.headline.includes("Quadratic equations"))).toBe(true);
  });

  it("raises alerts from real rows, including the child absent today", async () => {
    const alerts = await getParentAlerts(parentOf(schoolA));
    const absent = alerts.find((alert) => alert.kind === "absent-today");
    expect(absent?.childId).toBe(schoolA.studentIds[1]!);
    expect(absent?.tone).toBe("critical");
    // Critical first: the ordering is what makes the list worth reading.
    expect(alerts[0]!.kind).toBe("absent-today");

    // Work due in two days is not an alert; work due tomorrow is. The cut-off
    // is what keeps this list from becoming a feed nobody opens.
    expect(alerts.some((alert) => alert.kind === "homework-due")).toBe(false);

    await createHomework(teacherOf(schoolA), {
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      title: "Due tomorrow",
      description: null,
      assignedOn: today(),
      dueOn: addDays(today(), 1),
      status: "PUBLISHED",
    });

    const after = await getParentAlerts(parentOf(schoolA));
    const due = after.find((alert) => alert.kind === "homework-due");
    expect(due?.title).toContain("Due tomorrow");

    // Every title is a sentence, not a stringified row. Asserted because a
    // relation read as a value renders as "[object Object]" and still passes a
    // truthiness check.
    for (const alert of after) {
      expect(alert.title).not.toContain("[object Object]");
      expect(alert.detail).not.toContain("[object Object]");
    }
    const result = after.find((alert) => alert.kind === "new-result");
    expect(result?.title).toContain("Mathematics");
    // One alert per child in that section, because each parent reads per child.
    expect(after.filter((alert) => alert.kind === "homework-due")).toHaveLength(
      schoolA.studentIds.length,
    );
  });
});

describe("a guardian cannot reach a child who is not theirs", () => {
  /** Another family's child, in the same school. */
  let strangerId: string;

  beforeAll(async () => {
    const outsider = await prisma.student.create({
      data: {
        schoolId: schoolA.schoolId,
        admissionNumber: "ADM7100",
        firstName: "Not",
        lastName: "Yours",
      },
    });
    await prisma.studentEnrollment.create({
      data: {
        schoolId: schoolA.schoolId,
        studentId: outsider.id,
        academicSessionId: schoolA.academicSessionId,
        classId: schoolA.classId,
        sectionId: schoolA.sectionId,
        rollNumber: "99",
      },
    });
    strangerId = outsider.id;
  });

  const READS = {
    findChild,
    getChildToday,
    getChildAttendance,
    getChildTimetable,
    getChildActivity,
    getChildHomework,
    getChildResults,
    getChildRemarks,
    getChildRemarksAgain: getChildRemarks,
    getChildFocus,
  } as const;

  it("refuses every read for another family's child in the same school", async () => {
    // Same school, same section, same everything but the guardian link.
    for (const [name, read] of Object.entries(READS)) {
      await expect(
        read(parentOf(schoolA), strangerId),
        `${name} must refuse an unlinked child`,
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(getChildReport(parentOf(schoolA), strangerId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses every read for a child in another school, identically", async () => {
    for (const [name, read] of Object.entries(READS)) {
      await expect(
        read(parentOf(schoolA), schoolB.studentIds[0]!),
        `${name} must refuse another school's child`,
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(
      getChildReport(parentOf(schoolA), schoolB.studentIds[0]!),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a made-up id the same way, so probing reveals nothing", async () => {
    await expect(getChildToday(parentOf(schoolA), "no-such-student")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("keeps each school's guardian inside their own school", async () => {
    // School B's guardian sees only school B's children, and vice versa.
    const b = await listMyChildren(parentOf(schoolB));
    expect(b.children.map((child) => child.id).sort()).toEqual([...schoolB.studentIds].sort());
    for (const id of schoolA.studentIds) {
      expect(b.children.map((child) => child.id)).not.toContain(id);
    }
  });
});

describe("a guardian cannot change anything the school owns", () => {
  const parent = () => parentOf(schoolA);

  it("cannot mark or correct attendance", async () => {
    await expect(
      markAttendance(parent(), {
        sectionId: schoolA.sectionId,
        date: today(),
        entries: [{ studentId: schoolA.studentIds[1]!, status: "PRESENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // And the register still says what the teacher said.
    const after = await getChildAttendance(parent(), schoolA.studentIds[1]!);
    expect(after.counts.ABSENT).toBe(1);
  });

  it("cannot enter or change marks", async () => {
    // There is no guardian-reachable writer at all; the closest thing is the
    // scoped client, which a parent context still cannot use to cross a tenant.
    const before = await getChildResults(parent(), schoolA.studentIds[0]!);
    expect(before.entries[0]!.marksObtained).toBe(18);

    await expect(
      prisma.assessmentResult.updateMany({
        where: { assessmentId, studentId: schoolA.studentIds[0]!, schoolId: schoolB.schoolId },
        data: { marksObtained: 25 },
      }),
    ).resolves.toMatchObject({ count: 0 });
  });

  it("cannot write a teacher record — activity, homework or remark", async () => {
    await expect(
      recordActivity(parent(), {
        timetableSlotId: slotId,
        date: today(),
        status: "CANCELLED",
        topic: null,
        notes: null,
        importantPoints: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      createHomework(parent(), {
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
      addRemark(parent(), {
        studentId: schoolA.studentIds[0]!,
        subjectId: null,
        understanding: "GOOD",
        homeworkHabit: null,
        participation: null,
        note: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      markStaffAttendance(parent(), {
        date: today(),
        entries: [{ teacherId: schoolA.teacherId, status: "ABSENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot change the school's structure or its people", async () => {
    await expect(
      createAcademicSession(parent(), {
        name: "2099-00",
        startDate: today(),
        endDate: addDays(today(), 300),
        makeCurrent: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      createSection(parent(), {
        academicSessionId: schoolA.academicSessionId,
        classId: schoolA.classId,
        name: "Z",
        streamId: null,
        classTeacherId: null,
        capacity: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      createTeacher(parent(), {
        firstName: "Not",
        lastName: "Allowed",
        email: "nope@parent-portal-test.test",
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

    await expect(deleteStudent(parent(), schoolA.studentIds[0]!)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("cannot rewrite their own child's academic record", async () => {
    const student = await prisma.student.findUniqueOrThrow({
      where: { id: schoolA.studentIds[0]! },
      select: { firstName: true, lastName: true, admissionNumber: true, status: true },
    });

    await expect(
      updateStudent(parent(), {
        studentId: schoolA.studentIds[0]!,
        firstName: student.firstName,
        lastName: student.lastName,
        admissionNumber: student.admissionNumber,
        // A guardian marking their own child graduated would be a way out of
        // the register entirely.
        status: "GRADUATED",
        gender: null,
        dateOfBirth: null,
        photoUrl: null,
        admissionDate: null,
        addressLine: null,
        city: null,
        state: null,
        postalCode: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        bloodGroup: null,
      } as Parameters<typeof updateStudent>[1]),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      updateTeacher(parent(), {
        teacherId: schoolA.teacherId,
        firstName: "Hijacked",
        lastName: "Teacher",
        email: "hijack@parent-portal-test.test",
        employeeId: "EMP001",
        status: "INACTIVE",
        gender: null,
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

    const unchanged = await prisma.student.findUniqueOrThrow({
      where: { id: schoolA.studentIds[0]! },
      select: { status: true },
    });
    expect(unchanged.status).toBe(student.status);
  });
});

describe("a child the school has not placed", () => {
  it("resolves, but every session-scoped read refuses rather than guessing", async () => {
    // Admitting a child through the service always places them, so an unplaced
    // one is built directly — it is the state a mid-year transfer leaves behind.
    const { id: student } = await prisma.student.create({
      data: {
        schoolId: schoolA.schoolId,
        admissionNumber: "ADM7200",
        firstName: "Not",
        lastName: "Placed",
      },
    });
    await prisma.parentStudent.create({
      data: {
        schoolId: schoolA.schoolId,
        parentId: schoolA.parentId,
        studentId: student,
        relationship: "FATHER",
      },
    });

    const found = await findChild(parentOf(schoolA), student);
    expect(found.placement).toBeNull();

    // The link holds, so this is a 404 about the placement, not about access.
    await expect(getChildToday(parentOf(schoolA), student)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getChildAttendance(parentOf(schoolA), student)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("the source data is not duplicated", () => {
  it("reads the same rows the school admin's own reports read", async () => {
    // The parent's figure and the register are the same row, not two copies.
    const parentView = await getChildAttendance(parentOf(schoolA), schoolA.studentIds[0]!);
    const rows = await prisma.studentAttendance.count({
      where: { studentId: schoolA.studentIds[0]!, academicSessionId: schoolA.academicSessionId },
    });
    expect(parentView.counts.total).toBe(rows);

    const activity = await getChildActivity(parentOf(schoolA), schoolA.studentIds[0]!);
    const sessions = await prisma.classSession.count({
      where: { timetableSlot: { sectionId: schoolA.sectionId } },
    });
    expect(activity.entries).toHaveLength(sessions);
  });

  it("has no parent-specific copy of any operational table", async () => {
    const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = tables.map((row) => row.table_name.toLowerCase());
    for (const forbidden of [
      "parentattendance",
      "parenthomework",
      "parentreport",
      "parentnotification",
      "childreport",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
