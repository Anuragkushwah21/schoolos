/**
 * Streams in the timetable and homework.
 *
 * Class 11-A is split into Science and Commerce. Then:
 *
 *   * A period can be for one stream; Science and Commerce periods may run at
 *     the same time, a whole-section period clashes with both, and the same
 *     stream cannot have two at once. The teacher and room rules still hold.
 *   * A section that is one group never takes a stream — streams are not forced.
 *   * Students and parents see whole-section periods and homework plus their
 *     own stream's — never another stream's.
 *   * A teacher sets homework only for the streams they teach: a whole-section
 *     teacher for the section or any stream, a stream teacher for that stream.
 *   * Everything that existed before (no stream) stays visible to everyone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { TenantContext } from "@/server/auth/current-user";
import { createHomework } from "@/server/classwork/homework";
import { prisma } from "@/server/db/prisma";
import { getChildHomework, getChildTimetable } from "@/server/parent/child";
import { getMyHomeworkItem, getMyTimetable } from "@/server/student/me";
import { createSlot } from "@/server/timetable/service";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let section11: string;
let science: string;
let commerce: string;
let streamB: string;
let english: string;
let physics: string;
let accounts: string;
let teacher2: { id: string; ctx: TenantContext };
let scienceStudent: { id: string; ctx: TenantContext };
let commerceStudent: { id: string; ctx: TenantContext };
let parentCtx: TenantContext;

const MON = "MONDAY" as const;
const period = (start: number, extra: Record<string, unknown>) => ({ dayOfWeek: MON, startMinute: start, endMinute: start + 45, roomId: null, ...extra }) as Parameters<typeof createSlot>[1];

async function student(name: string, streamId: string) {
  const user = await prisma.user.create({ data: { email: `${name}@sth-test.test`, passwordHash: "x", role: "STUDENT", firstName: name, lastName: "S", schoolId: schoolA.schoolId } });
  const row = await prisma.student.create({ data: { schoolId: schoolA.schoolId, userId: user.id, admissionNumber: `STH-${name}`, firstName: name, lastName: "S" } });
  const klass = await prisma.section.findUniqueOrThrow({ where: { id: section11 }, select: { classId: true } });
  await prisma.studentEnrollment.create({ data: { schoolId: schoolA.schoolId, studentId: row.id, academicSessionId: schoolA.academicSessionId, classId: klass.classId, sectionId: section11, streamId } });
  return { id: row.id, ctx: contextFor(schoolA, user.id, "STUDENT") };
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const schoolId = schoolA.schoolId;
  const klass = await prisma.class.create({ data: { schoolId, name: "Class 11", level: 11 } });
  section11 = (await prisma.section.create({ data: { schoolId, academicSessionId: schoolA.academicSessionId, classId: klass.id, name: "A" } })).id;
  science = (await prisma.stream.create({ data: { schoolId, name: "Science" } })).id;
  commerce = (await prisma.stream.create({ data: { schoolId, name: "Commerce" } })).id;
  await prisma.stream.create({ data: { schoolId, name: "Arts" } }); // not offered in 11-A
  streamB = (await prisma.stream.create({ data: { schoolId: schoolB.schoolId, name: "Science" } })).id;
  await prisma.sectionStream.createMany({ data: [science, commerce].map((streamId) => ({ schoolId, sectionId: section11, streamId, capacity: 30 })) });
  english = (await prisma.subject.create({ data: { schoolId, name: "English", code: "ENG" } })).id;
  physics = (await prisma.subject.create({ data: { schoolId, name: "Physics", code: "PHY" } })).id;
  accounts = (await prisma.subject.create({ data: { schoolId, name: "Accountancy", code: "ACC" } })).id;
  const user = await prisma.user.create({ data: { email: "t2@sth-test.test", passwordHash: "x", role: "TEACHER", firstName: "Neha", lastName: "Rao", schoolId } });
  const t2 = await prisma.teacher.create({ data: { schoolId, userId: user.id, employeeId: "STH-T2", firstName: "Neha", lastName: "Rao" } });
  teacher2 = { id: t2.id, ctx: contextFor(schoolA, user.id, "TEACHER") };
  scienceStudent = await student("sci", science);
  commerceStudent = await student("com", commerce);
  const parentUser = await prisma.user.create({ data: { email: "p@sth-test.test", passwordHash: "x", role: "PARENT", firstName: "P", lastName: "S", schoolId } });
  const parent = await prisma.parent.create({ data: { schoolId, userId: parentUser.id, firstName: "P", lastName: "S", phone: "+91 98888 77777" } });
  await prisma.parentStudent.create({ data: { schoolId, parentId: parent.id, studentId: scienceStudent.id, relationship: "GUARDIAN", isPrimary: true } });
  parentCtx = contextFor(schoolA, parentUser.id, "PARENT");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("timetable periods by stream", () => {
  it("runs Science and Commerce side by side; a whole-section period clashes with both", async () => {
    const admin = adminOf(schoolA);
    await createSlot(admin, period(540, { sectionId: section11, subjectId: english, teacherId: schoolA.teacherId }));
    await createSlot(admin, period(600, { sectionId: section11, subjectId: physics, teacherId: schoolA.teacherId, streamId: science }));
    await createSlot(admin, period(600, { sectionId: section11, subjectId: accounts, teacherId: teacher2.id, streamId: commerce }));
    // Whole section at the same time as the stream periods.
    await expect(createSlot(admin, period(610, { sectionId: section11, subjectId: english, teacherId: teacher2.id }))).rejects.toBeInstanceOf(ConflictError);
    // Science already busy.
    await expect(createSlot(admin, period(620, { sectionId: section11, subjectId: english, teacherId: teacher2.id, streamId: science }))).rejects.toBeInstanceOf(ConflictError);
    // A stream period during a whole-section one.
    await expect(createSlot(admin, period(550, { sectionId: section11, subjectId: accounts, teacherId: teacher2.id, streamId: commerce }))).rejects.toBeInstanceOf(ConflictError);
    // One teacher cannot be in two streams at once.
    await expect(createSlot(admin, period(1000, { sectionId: section11, subjectId: physics, teacherId: schoolA.teacherId, streamId: science })).then(() =>
      createSlot(admin, period(1000, { sectionId: section11, subjectId: accounts, teacherId: schoolA.teacherId, streamId: commerce })),
    )).rejects.toBeInstanceOf(ConflictError);
  });

  it("gives the teacher an assignment for the period's stream", async () => {
    const rows = await prisma.teacherSubjectAssignment.findMany({ where: { sectionId: section11, subjectId: { in: [physics, accounts] } }, select: { subjectId: true, streamId: true } });
    expect(rows).toEqual(expect.arrayContaining([{ subjectId: physics, streamId: science }, { subjectId: accounts, streamId: commerce }]));
  });

  it("never takes a stream the section is not split into, or another school's", async () => {
    const admin = adminOf(schoolA);
    const arts = (await prisma.stream.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, name: "Arts" } })).id;
    await expect(createSlot(admin, period(700, { sectionId: section11, subjectId: english, teacherId: teacher2.id, streamId: arts }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createSlot(admin, period(700, { sectionId: section11, subjectId: english, teacherId: teacher2.id, streamId: streamB }))).rejects.toBeInstanceOf(ValidationError);
    // Class 10-A is one group: no stream at all, and its periods work as before.
    await expect(createSlot(admin, period(700, { sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, teacherId: teacher2.id, streamId: science }))).rejects.toBeInstanceOf(ValidationError);
    await createSlot(admin, period(700, { sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, teacherId: teacher2.id }));
  });

  it("students and parents see whole-section periods plus their own stream's only", async () => {
    const subjectsOf = (slots: Array<{ subject: { name: string } }>) => [...new Set(slots.map((slot) => slot.subject.name))].sort();
    expect(subjectsOf((await getMyTimetable(scienceStudent.ctx)).slots)).toEqual(["English", "Physics"]);
    expect(subjectsOf((await getMyTimetable(commerceStudent.ctx)).slots)).toEqual(["Accountancy", "English"]);
    expect(subjectsOf((await getChildTimetable(parentCtx, scienceStudent.id)).slots)).toEqual(["English", "Physics"]);
  });
});

describe("homework by stream", () => {
  const work = (extra: Record<string, unknown>) =>
    ({ title: `HW ${Math.random()}`, description: null, assignedOn: today(), dueOn: addDays(today(), 3), status: "PUBLISHED", sectionId: section11, ...extra }) as Parameters<typeof createHomework>[1];
  let physicsHw: string;
  let englishHw: string;

  it("a stream teacher sets work for their stream only", async () => {
    // The fixture teacher teaches Physics to Science only (from the timetable).
    await expect(createHomework(teacherOf(schoolA), work({ subjectId: physics, streamId: commerce }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createHomework(teacherOf(schoolA), work({ subjectId: physics, streamId: null }))).rejects.toBeInstanceOf(ForbiddenError);
    physicsHw = (await createHomework(teacherOf(schoolA), work({ subjectId: physics, streamId: science }))).id;
    // Nobody sets work in a subject they do not teach.
    await expect(createHomework(teacher2.ctx, work({ subjectId: physics, streamId: science }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a whole-section teacher sets work for the section or any of its streams", async () => {
    englishHw = (await createHomework(teacherOf(schoolA), work({ subjectId: english, streamId: null }))).id;
    await createHomework(teacherOf(schoolA), work({ subjectId: english, streamId: commerce }));
    await expect(createHomework(teacherOf(schoolA), work({ subjectId: english, streamId: streamB }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("a section that is one group takes no stream", async () => {
    await createHomework(teacherOf(schoolA), work({ sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, streamId: null }));
    await expect(createHomework(teacherOf(schoolA), work({ sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, streamId: science }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("students and parents see only whole-section work and their own stream's", async () => {
    await expect(getMyHomeworkItem(scienceStudent.ctx, physicsHw)).resolves.toBeTruthy();
    await expect(getMyHomeworkItem(commerceStudent.ctx, physicsHw)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMyHomeworkItem(commerceStudent.ctx, englishHw)).resolves.toBeTruthy();
    const child = await getChildHomework(parentCtx, scienceStudent.id);
    const ids = Object.values(child).flatMap((value) => (Array.isArray(value) ? value.map((row: { id: string }) => row.id) : []));
    expect(ids).toContain(physicsHw);
    expect(ids).toContain(englishHw);
    const commerceOnly = await prisma.homework.findFirstOrThrow({ where: { streamId: commerce }, select: { id: true } });
    expect(ids).not.toContain(commerceOnly.id);
  });

  it("keeps work set before streams visible to the whole section", async () => {
    const old = await prisma.homework.create({
      data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, sectionId: section11, subjectId: english, teacherId: schoolA.teacherId, title: "Old", assignedOn: today(), dueOn: addDays(today(), 2), status: "PUBLISHED" },
    });
    await expect(getMyHomeworkItem(scienceStudent.ctx, old.id)).resolves.toBeTruthy();
    await expect(getMyHomeworkItem(commerceStudent.ctx, old.id)).resolves.toBeTruthy();
  });
});
