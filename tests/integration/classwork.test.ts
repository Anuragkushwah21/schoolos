/**
 * What a teacher records about their teaching — and the three boundaries that
 * decide whether they may.
 *
 * Homework needs a subject assignment (teaching the class is not enough), a
 * lesson record needs the period to be theirs, and a remark needs the child to
 * be currently enrolled in a section they reach. Editing anything needs
 * authorship on top, which is why a second teacher in the same school appears
 * throughout.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, dayOfWeek, today } from "@/lib/dates";
import { prisma } from "@/server/db/prisma";
import {
  ACTIVITY_WINDOW_DAYS,
  getMyActivity,
  getMyDayPlan,
  listMyActivities,
  recordActivity,
} from "@/server/classwork/activities";
import {
  createHomework,
  deleteHomework,
  getMyHomework,
  homeworkDueForMySections,
  listMyHomework,
  pendingHomeworkCount,
  updateHomework,
} from "@/server/classwork/homework";
import {
  addRemark,
  deleteRemark,
  remarksForStudent,
  updateRemark,
} from "@/server/classwork/remarks";
import { assignSubstitute, clearSubstitute } from "@/server/classwork/substitutes";
import type { TenantContext } from "@/server/auth/current-user";
import { myTeachingOptions } from "@/server/people/teacher-self";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

/** A second teacher in school A, assigned to the same subject and section. */
let colleague: { id: string; ctx: TenantContext };
/** A slot of school A's own teacher, on today's weekday. */
let slotId: string;
/** A slot in the section school A's teacher does not teach. */
let foreignSlotId: string;

const base = { title: "Exercise 4.2", description: null, status: "PUBLISHED" as const };

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());

  const user = await prisma.user.create({
    data: {
      email: "colleague@iso-test-a.test",
      passwordHash: "not-a-real-hash",
      role: "TEACHER",
      firstName: "Second",
      lastName: "Teacher",
      schoolId: schoolA.schoolId,
    },
  });
  const teacher = await prisma.teacher.create({
    data: {
      schoolId: schoolA.schoolId,
      userId: user.id,
      employeeId: "EMP002",
      firstName: "Second",
      lastName: "Teacher",
    },
  });
  await prisma.teacherSubjectAssignment.create({
    data: {
      schoolId: schoolA.schoolId,
      academicSessionId: schoolA.academicSessionId,
      teacherId: teacher.id,
      subjectId: schoolA.subjectId,
      sectionId: schoolA.sectionId,
    },
  });
  colleague = { id: teacher.id, ctx: contextFor(schoolA, user.id, "TEACHER") };

  const day = dayOfWeek(today());
  const own = await prisma.timetableSlot.create({
    data: {
      schoolId: schoolA.schoolId,
      academicSessionId: schoolA.academicSessionId,
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      teacherId: schoolA.teacherId,
      dayOfWeek: day,
      startMinute: 540,
      endMinute: 585,
    },
  });
  slotId = own.id;

  // Same school, same day — but the colleague's period, in the section school
  // A's teacher is not assigned to.
  const other = await prisma.timetableSlot.create({
    data: {
      schoolId: schoolA.schoolId,
      academicSessionId: schoolA.academicSessionId,
      sectionId: schoolA.unassignedSectionId,
      subjectId: schoolA.subjectId,
      teacherId: colleague.id,
      dayOfWeek: day,
      startMinute: 600,
      endMinute: 645,
    },
  });
  foreignSlotId = other.id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("what a teacher may set homework for", () => {
  it("offers only the subjects assigned to each class", async () => {
    const options = await myTeachingOptions(teacherOf(schoolA));
    expect(options).toHaveLength(1);
    expect(options[0]!.sectionId).toBe(schoolA.sectionId);
    expect(options[0]!.subjects.map((subject) => subject.id)).toEqual([schoolA.subjectId]);
  });

  it("accepts the assigned pair and refuses a section the teacher only shares a school with", async () => {
    const ctx = teacherOf(schoolA);
    const created = await createHomework(ctx, {
      ...base,
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      assignedOn: today(),
      dueOn: addDays(today(), 3),
    });
    expect(created.id).toBeTruthy();

    // Class teachership is not a subject assignment, and this section has
    // neither.
    await expect(
      createHomework(ctx, {
        ...base,
        sectionId: schoolA.unassignedSectionId,
        subjectId: schoolA.subjectId,
        assignedOn: today(),
        dueOn: today(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await deleteHomework(ctx, created.id);
  });

  it("refuses a section belonging to another school", async () => {
    await expect(
      createHomework(teacherOf(schoolA), {
        ...base,
        sectionId: schoolB.sectionId,
        subjectId: schoolB.subjectId,
        assignedOn: today(),
        dueOn: today(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses work due before it is set", async () => {
    await expect(
      createHomework(teacherOf(schoolA), {
        ...base,
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        assignedOn: today(),
        dueOn: addDays(today(), -1),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("is closed to a school admin, who does not teach", async () => {
    await expect(
      createHomework(adminOf(schoolA), {
        ...base,
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        assignedOn: today(),
        dueOn: today(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("whose homework a teacher can read and change", () => {
  let mine: string;
  let theirs: string;

  beforeAll(async () => {
    mine = (
      await createHomework(teacherOf(schoolA), {
        ...base,
        title: "Mine",
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        assignedOn: today(),
        dueOn: addDays(today(), 2),
      })
    ).id;
    theirs = (
      await createHomework(colleague.ctx, {
        ...base,
        title: "Theirs",
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        assignedOn: today(),
        dueOn: addDays(today(), 2),
      })
    ).id;
  });

  it("lists only what the teacher set themselves", async () => {
    const list = await listMyHomework(teacherOf(schoolA));
    expect(list.map((item) => item.id)).toContain(mine);
    expect(list.map((item) => item.id)).not.toContain(theirs);
  });

  it("counts only their own work as pending", async () => {
    await expect(pendingHomeworkCount(teacherOf(schoolA))).resolves.toBe(1);
  });

  it("shows both teachers' work for a section they can reach", async () => {
    const due = await homeworkDueForMySections(teacherOf(schoolA), {
      from: today(),
      to: addDays(today(), 7),
    });
    expect(due.map((item) => item.id).sort()).toEqual([mine, theirs].sort());
  });

  it("refuses to open, edit or delete a colleague's work", async () => {
    const ctx = teacherOf(schoolA);
    await expect(getMyHomework(ctx, theirs)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateHomework(ctx, theirs, {
        ...base,
        title: "Hijacked",
        sectionId: schoolA.sectionId,
        subjectId: schoolA.subjectId,
        assignedOn: today(),
        dueOn: today(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteHomework(ctx, theirs)).rejects.toBeInstanceOf(ForbiddenError);

    // Untouched.
    await expect(getMyHomework(colleague.ctx, theirs)).resolves.toMatchObject({ title: "Theirs" });
  });

  it("hides work in another school behind the same answer as a missing row", async () => {
    const elsewhere = await createHomework(teacherOf(schoolB), {
      ...base,
      sectionId: schoolB.sectionId,
      subjectId: schoolB.subjectId,
      assignedOn: today(),
      dueOn: today(),
    });
    await expect(getMyHomework(teacherOf(schoolA), elsewhere.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("writing up a lesson", () => {
  it("records the teacher's own period and corrects it in place", async () => {
    const ctx = teacherOf(schoolA);
    const first = await recordActivity(ctx, {
      timetableSlotId: slotId,
      date: today(),
      status: "COMPLETED",
      topic: "Quadratic equations",
      importantPoints: null,
        notes: null,
    });
    const again = await recordActivity(ctx, {
      timetableSlotId: slotId,
      date: today(),
      status: "REMOTE",
      topic: "Quadratic equations, part two",
      importantPoints: null,
        notes: "Power cut in the block.",
    });

    // One record per period per day, not two accounts of one lesson.
    expect(again.id).toBe(first.id);
    const stored = await getMyActivity(ctx, first.id);
    expect(stored.status).toBe("REMOTE");
    expect(stored.topic).toBe("Quadratic equations, part two");
  });

  it("refuses a period belonging to another teacher, in or out of the school", async () => {
    const ctx = teacherOf(schoolA);
    for (const id of [foreignSlotId, "no-such-slot"]) {
      await expect(
        recordActivity(ctx, {
          timetableSlotId: id,
          date: today(),
          status: "COMPLETED",
          topic: null,
          importantPoints: null,
        notes: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("refuses a lesson that has not happened, or one too old to correct", async () => {
    const ctx = teacherOf(schoolA);
    await expect(
      recordActivity(ctx, {
        timetableSlotId: slotId,
        date: addDays(today(), 7),
        status: "COMPLETED",
        topic: null,
        importantPoints: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(AppError);

    await expect(
      recordActivity(ctx, {
        // Same weekday, so only the age of it can be the objection.
        timetableSlotId: slotId,
        date: addDays(today(), -(ACTIVITY_WINDOW_DAYS + 7)),
        status: "COMPLETED",
        topic: null,
        importantPoints: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a date that is not the period's own weekday", async () => {
    await expect(
      recordActivity(teacherOf(schoolA), {
        timetableSlotId: slotId,
        date: addDays(today(), -1),
        status: "COMPLETED",
        topic: null,
        notes: null,
        importantPoints: null,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("shows the day's periods with what has been written up, and hides colleagues' records", async () => {
    const plan = await getMyDayPlan(teacherOf(schoolA));
    expect(plan.periods.map((period) => period.slotId)).toEqual([slotId]);
    expect(plan.periods[0]!.recorded).toBe(true);

    const mine = await listMyActivities(teacherOf(schoolA));
    expect(mine.map((entry) => entry.slotId)).toContain(slotId);

    // Asserted by absence of this record rather than an empty list, so a later
    // describe that legitimately gives the colleague a record of their own
    // cannot quietly invalidate this one.
    const theirs = await listMyActivities(colleague.ctx);
    expect(theirs.map((entry) => entry.id)).not.toContain(mine[0]!.id);
    await expect(getMyActivity(colleague.ctx, mine[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("covering an absent teacher", () => {
  it("lets the office name a stand-in, who may then write the class up", async () => {
    const admin = adminOf(schoolA);
    const record = await assignSubstitute(admin, {
      timetableSlotId: slotId,
      date: today(),
      teacherId: colleague.id,
    });
    expect(record.id).toBeTruthy();

    // The colleague does not teach this section at all, so the assignment is
    // the only thing letting them in.
    const written = await recordActivity(colleague.ctx, {
      timetableSlotId: slotId,
      date: today(),
      status: "COMPLETED",
      topic: "Covered the revision sheet",
      importantPoints: null,
        notes: null,
    });
    const stored = await getMyActivity(colleague.ctx, written.id);
    // Their own "completed" is kept as SUBSTITUTE: the record must not read as
    // though the scheduled teacher took it.
    expect(stored.status).toBe("SUBSTITUTE");
    expect(stored.topic).toBe("Covered the revision sheet");
  });

  it("still refuses a teacher who was not assigned the cover", async () => {
    // A third teacher, with no claim on the period at all.
    const user = await prisma.user.create({
      data: {
        email: "outsider@iso-test-a.test",
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
        employeeId: "EMP003",
        firstName: "No",
        lastName: "Claim",
      },
    });

    await expect(
      recordActivity(contextFor(schoolA, user.id, "TEACHER"), {
        timetableSlotId: slotId,
        date: today(),
        status: "COMPLETED",
        topic: null,
        notes: null,
        importantPoints: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is the office's call, not a teacher's", async () => {
    await expect(
      assignSubstitute(teacherOf(schoolA), {
        timetableSlotId: slotId,
        date: today(),
        teacherId: colleague.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses cover by the teacher who already takes the period", async () => {
    await expect(
      assignSubstitute(adminOf(schoolA), {
        timetableSlotId: slotId,
        date: today(),
        teacherId: schoolA.teacherId,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a date that is not the period's weekday", async () => {
    await expect(
      assignSubstitute(adminOf(schoolA), {
        timetableSlotId: slotId,
        date: addDays(today(), -1),
        teacherId: colleague.id,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("hands the period back when the cover is cleared", async () => {
    const record = await assignSubstitute(adminOf(schoolA), {
      timetableSlotId: slotId,
      date: today(),
      teacherId: colleague.id,
    });
    await clearSubstitute(adminOf(schoolA), record.id);

    const after = await prisma.classSession.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.status).toBe("SCHEDULED");
    expect(after.actualTeacherId).toBeNull();

    // And the stand-in loses the only route they had into that period.
    await expect(
      recordActivity(colleague.ctx, {
        timetableSlotId: slotId,
        date: today(),
        status: "COMPLETED",
        topic: null,
        importantPoints: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("remarks about a child", () => {
  it("refuses a remark that answers nothing and says nothing", async () => {
    await expect(
      addRemark(teacherOf(schoolA), {
        studentId: schoolA.studentIds[0]!,
        subjectId: null,
        understanding: null,
        homeworkHabit: null,
        participation: null,
        note: null,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("accepts a remark about a child in the teacher's section", async () => {
    const created = await addRemark(teacherOf(schoolA), {
      studentId: schoolA.studentIds[0]!,
      subjectId: schoolA.subjectId,
      understanding: "NEEDS_ATTENTION",
      homeworkHabit: "SOMETIMES_MISSING",
      participation: "AVERAGE",
      note: "Needs more practice in algebra.",
    });
    expect(created.id).toBeTruthy();
  });

  it("refuses a child in another section of the same school", async () => {
    const outsider = await prisma.student.create({
      data: {
        schoolId: schoolA.schoolId,
        admissionNumber: "ADM8001",
        firstName: "Other",
        lastName: "Section",
      },
    });
    await prisma.studentEnrollment.create({
      data: {
        schoolId: schoolA.schoolId,
        studentId: outsider.id,
        academicSessionId: schoolA.academicSessionId,
        classId: schoolA.classId,
        sectionId: schoolA.unassignedSectionId,
        rollNumber: "1",
      },
    });

    await expect(
      addRemark(teacherOf(schoolA), {
        studentId: outsider.id,
        subjectId: null,
        understanding: "GOOD",
        homeworkHabit: null,
        participation: null,
        note: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(remarksForStudent(teacherOf(schoolA), outsider.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses a child in another school as though they did not exist", async () => {
    await expect(
      addRemark(teacherOf(schoolA), {
        studentId: schoolB.studentIds[0]!,
        subjectId: null,
        understanding: "GOOD",
        homeworkHabit: null,
        participation: null,
        note: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets colleagues read the record but only the author change it", async () => {
    const theirs = await addRemark(colleague.ctx, {
      studentId: schoolA.studentIds[0]!,
      subjectId: null,
      understanding: null,
      homeworkHabit: null,
      participation: "NEEDS_IMPROVEMENT",
      note: "Quiet in class.",
    });

    const asAuthor = await remarksForStudent(colleague.ctx, schoolA.studentIds[0]!);
    expect(asAuthor.find((remark) => remark.id === theirs.id)?.mine).toBe(true);

    const asColleague = await remarksForStudent(teacherOf(schoolA), schoolA.studentIds[0]!);
    // Both remarks are readable; only one is theirs to change.
    expect(asColleague).toHaveLength(2);
    expect(asColleague.find((remark) => remark.id === theirs.id)?.mine).toBe(false);

    await expect(
      updateRemark(teacherOf(schoolA), theirs.id, {
        understanding: null,
        homeworkHabit: null,
        participation: null,
        note: "Rewritten.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteRemark(teacherOf(schoolA), theirs.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await updateRemark(colleague.ctx, theirs.id, {
      understanding: null,
      homeworkHabit: null,
      participation: "ACTIVE",
      note: "Quiet, but improving.",
    });
    const after = await remarksForStudent(colleague.ctx, schoolA.studentIds[0]!);
    const updated = after.find((remark) => remark.id === theirs.id);
    expect(updated?.note).toBe("Quiet, but improving.");
    expect(updated?.participation).toBe("ACTIVE");

    await deleteRemark(colleague.ctx, theirs.id);
    await expect(remarksForStudent(colleague.ctx, schoolA.studentIds[0]!)).resolves.toHaveLength(1);
  });
});
