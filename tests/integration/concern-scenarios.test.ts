/**
 * The seven scenarios of the simple subject-wise concern system, as written
 * in the brief: Rahul in 9-A Science, Amit teaches Science Mathematics, Ravi
 * teaches Commerce Mathematics.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dayOfWeek, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { supportSchema } from "@/lib/validation/support";
import { createStudentSchema } from "@/lib/validation/school";
import { saveStreamAllocations } from "@/server/academics/streams";
import { getTeacherAlerts } from "@/server/alerts/feeds";
import { prisma } from "@/server/db/prisma";
import { getParentAlerts } from "@/server/parent/alerts";
import { createStudent } from "@/server/people/students";
import { assignSubject } from "@/server/people/teachers";
import { getMyDayPlan } from "@/server/classwork/activities";
import { assignSubstitute, clearSubstitute } from "@/server/classwork/substitutes";
import { createSupport, listSupport, supportFormOptions } from "@/server/support/service";
import {
  getConcern,
  listConcerns,
  raiseParentConcern,
  raiseTeacherConcern,
  replyToConcern,
  requestConcernUpdate,
  teacherConcernOptions,
} from "@/server/support/concerns";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let school: SeededSchool;
let other: SeededSchool;
let mathsId: string;
let scienceSubjectId: string;
const stream = { Science: "", Commerce: "", Arts: "" };
const teacher: Record<"Amit" | "Ravi" | "Neha", { id: string; userId: string }> = {} as never;
let sectionA: string;
const student: Record<"Rahul" | "Karan" | "Priya", { id: string; parentUserId: string }> = {} as never;

const teacherCtx = (name: "Amit" | "Ravi" | "Neha") => contextFor(school, teacher[name].userId, "TEACHER");
const parentCtx = (name: keyof typeof student) => contextFor(school, student[name].parentUserId, "PARENT");

beforeAll(async () => {
  ({ schoolA: school, schoolB: other } = await createIsolationFixture());
  mathsId = school.subjectId; // "Mathematics"
  scienceSubjectId = (await prisma.subject.create({ data: { schoolId: school.schoolId, name: "Science", code: "SCI9" } })).id;
  const classId = (await prisma.class.create({ data: { schoolId: school.schoolId, name: "Class 9", level: 9 } })).id;
  const sectionId = (sectionA = (await prisma.section.create({ data: { schoolId: school.schoolId, academicSessionId: school.academicSessionId, classId, name: "A", capacity: 40 } })).id);
  for (const name of Object.keys(stream) as Array<keyof typeof stream>) {
    stream[name] = (await prisma.stream.create({ data: { schoolId: school.schoolId, name } })).id;
  }
  await saveStreamAllocations(adminOf(school), sectionId, [
    { streamId: stream.Science, capacity: 20 },
    { streamId: stream.Commerce, capacity: 10 },
    { streamId: stream.Arts, capacity: 10 },
  ]);
  for (const name of ["Amit", "Ravi", "Neha"] as const) {
    const user = await prisma.user.create({ data: { email: `${name.toLowerCase()}@scenarios.test`, passwordHash: "x", role: "TEACHER", firstName: name, lastName: "Kumar", schoolId: school.schoolId, activatedAt: new Date() } });
    const row = await prisma.teacher.create({ data: { schoolId: school.schoolId, userId: user.id, employeeId: `SC-${name}`, firstName: name, lastName: "Kumar" } });
    teacher[name] = { id: row.id, userId: user.id };
  }
  await assignSubject(adminOf(school), { teacherId: teacher.Amit.id, subjectId: mathsId, sectionId, streamId: stream.Science });
  await assignSubject(adminOf(school), { teacherId: teacher.Ravi.id, subjectId: mathsId, sectionId, streamId: stream.Commerce });
  // Neha is 9-A's class teacher and teaches it no Mathematics.
  await prisma.section.update({ where: { id: sectionId }, data: { classTeacherId: teacher.Neha.id } });

  let n = 0;
  for (const [name, streamName] of [["Rahul", "Science"], ["Karan", "Commerce"], ["Priya", "Arts"]] as const) {
    n += 1;
    const { studentId } = await createStudent(
      adminOf(school),
      createStudentSchema.parse({
        firstName: name,
        lastName: "Sharma",
        sectionId,
        streamId: stream[streamName],
        guardianMode: "new",
        parentFirstName: "Parent",
        parentLastName: name,
        parentPhone: `+91 96000 0000${n}`,
        relationship: "FATHER",
      }),
    );
    const link = await prisma.parentStudent.findFirstOrThrow({ where: { studentId }, select: { parentId: true } });
    const user = await prisma.user.create({ data: { email: `parent.${name.toLowerCase()}@scenarios.test`, passwordHash: "x", role: "PARENT", firstName: "Parent", lastName: name, schoolId: school.schoolId, activatedAt: new Date() } });
    await prisma.parent.update({ where: { id: link.parentId }, data: { userId: user.id } });
    student[name] = { id: studentId, parentUserId: user.id };
  }
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

let rahulConcernId: string;

describe("subject-wise concerns — the brief's scenarios", () => {
  it("1. Rahul (9-A Science) — parent's Mathematics concern goes to Amit", async () => {
    const concern = await raiseParentConcern(parentCtx("Rahul"), {
      studentId: student.Rahul.id,
      subjectId: mathsId,
      type: "ACADEMIC",
      message: "My child is having difficulty understanding fractions. Please pay some extra attention to this topic.",
    });
    rahulConcernId = concern.id;
    expect(concern.teacher).toBe("Amit Kumar");
    const row = await prisma.supportConcern.findUniqueOrThrow({ where: { id: concern.id } });
    expect(row).toMatchObject({ teacherId: teacher.Amit.id, raisedBy: "PARENT", status: "OPEN", streamId: stream.Science });
    // Amit is told.
    expect((await getTeacherAlerts(teacherCtx("Amit"))).some((alert) => alert.title === "New Mathematics concern from Rahul Sharma's parent")).toBe(true);
  });

  it("2. a Commerce student's Mathematics concern goes to Ravi, not Amit", async () => {
    const concern = await raiseParentConcern(parentCtx("Karan"), { studentId: student.Karan.id, subjectId: mathsId, type: "ACADEMIC", message: "Karan needs help with algebra." });
    expect(concern.teacher).toBe("Ravi Kumar");
    expect((await listConcerns(teacherCtx("Amit"), { status: "ALL" })).map((row) => row.id)).not.toContain(concern.id);
    expect((await listConcerns(teacherCtx("Ravi"), { status: "ALL" })).map((row) => row.id)).toContain(concern.id);
  });

  it("3. Amit teaches Mathematics — he cannot create a Science concern, or one for a Commerce student", async () => {
    await expect(raiseTeacherConcern(teacherCtx("Amit"), { studentId: student.Rahul.id, subjectId: scienceSubjectId, type: "ACADEMIC", priority: "MEDIUM", message: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(raiseTeacherConcern(teacherCtx("Amit"), { studentId: student.Karan.id, subjectId: mathsId, type: "ACADEMIC", priority: "MEDIUM", message: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    // His form offers only his students, with Mathematics set for him.
    const options = await teacherConcernOptions(teacherCtx("Amit"));
    expect(options.map((row) => row.value)).toEqual([student.Rahul.id]);
    expect(options[0]!.subjects).toEqual([{ value: mathsId, label: "Mathematics" }]);
    // What he may do, he can: the parent is told.
    await raiseTeacherConcern(teacherCtx("Amit"), { studentId: student.Rahul.id, subjectId: mathsId, type: "ACADEMIC", priority: "MEDIUM", message: "Student needs additional practice in fractions." });
    expect((await getParentAlerts(parentCtx("Rahul"))).some((alert) => alert.title === "New Mathematics concern for Rahul Sharma")).toBe(true);
  });

  it("4. no Mathematics teacher for Arts — the concern goes to the School Admin, not lost", async () => {
    const concern = await raiseParentConcern(parentCtx("Priya"), { studentId: student.Priya.id, subjectId: mathsId, type: "ACADEMIC", message: "Priya struggles with graphs." });
    expect(concern.teacher).toBeNull();
    const office = await listConcerns(adminOf(school), { assigned: "NONE" });
    expect(office.map((row) => row.id)).toEqual([concern.id]);
  });

  it("5. the admin sees every concern in the school with its status — and another school sees none", async () => {
    const rows = await listConcerns(adminOf(school), { status: "ALL" });
    expect(rows).toHaveLength(4);
    const rahul = rows.find((row) => row.id === rahulConcernId)!;
    expect(rahul).toMatchObject({ student: "Rahul Sharma", group: "Class 9 – A • Science", stream: "Science", subject: "Mathematics", raisedBy: "PARENT", teacher: "Amit Kumar", status: "OPEN" });
    expect(rahul.createdAt).toBeInstanceOf(Date);
    expect((await listConcerns(adminOf(school), { streamId: stream.Commerce })).map((row) => row.teacher)).toEqual(["Ravi Kumar"]);
    expect((await listConcerns(adminOf(school), { raisedBy: "TEACHER" })).map((row) => row.student)).toEqual(["Rahul Sharma"]);
    expect(await listConcerns(adminOf(other), { status: "ALL" })).toEqual([]);
  });

  it("6. admin's Request Action notifies the assigned teacher", async () => {
    await requestConcernUpdate(adminOf(school), { concernId: rahulConcernId, note: null });
    const alerts = await getTeacherAlerts(teacherCtx("Amit"));
    expect(alerts.some((alert) => alert.title === "School Admin requested an update for Rahul's Mathematics concern")).toBe(true);
    expect((await getTeacherAlerts(teacherCtx("Ravi"))).some((alert) => alert.title.includes("Rahul"))).toBe(false);
  });

  it("7. Amit moves it OPEN → IN_PROGRESS → RESOLVED; parent and admin see each status; nobody else can", async () => {
    await expect(replyToConcern(teacherCtx("Ravi"), { concernId: rahulConcernId, message: null, status: "RESOLVED" })).rejects.toThrow();
    await expect(replyToConcern(parentCtx("Rahul"), { concernId: rahulConcernId, message: null, status: "RESOLVED" })).rejects.toBeInstanceOf(ForbiddenError);

    await replyToConcern(teacherCtx("Amit"), { concernId: rahulConcernId, message: null, status: "IN_PROGRESS" });
    expect((await getConcern(parentCtx("Rahul"), rahulConcernId)).status).toBe("IN_PROGRESS");
    expect((await getConcern(adminOf(school), rahulConcernId))).toMatchObject({ status: "IN_PROGRESS", updateRequested: false });

    await replyToConcern(teacherCtx("Amit"), { concernId: rahulConcernId, message: null, status: "RESOLVED" });
    const parentView = await getConcern(parentCtx("Rahul"), rahulConcernId);
    expect(parentView).toMatchObject({ status: "RESOLVED", teacher: "Amit Kumar", mayChangeStatus: false });
    expect((await getConcern(adminOf(school), rahulConcernId)).status).toBe("RESOLVED");
    expect((await getParentAlerts(parentCtx("Rahul"))).some((alert) => alert.title === "Teacher Amit Kumar updated Rahul's Mathematics concern")).toBe(true);
    // Another parent cannot open it.
    await expect(getConcern(parentCtx("Karan"), rahulConcernId)).rejects.toThrow();
  });
});

const support = (overrides: Record<string, unknown>) => supportSchema.parse({ reason: "NEEDS_PRACTICE", action: "EXTRA_PRACTICE", ...overrides });

describe("only the students you teach — support too", () => {
  it("a teacher adds support only for their own students, in their own subject", async () => {
    await expect(createSupport(teacherCtx("Amit"), support({ studentId: student.Karan.id, subjectId: mathsId }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSupport(teacherCtx("Amit"), support({ studentId: student.Rahul.id, subjectId: scienceSubjectId }))).rejects.toBeInstanceOf(ForbiddenError);
    await createSupport(teacherCtx("Amit"), support({ studentId: student.Rahul.id, subjectId: mathsId }));
    // His form offers the same: Rahul, Mathematics only.
    const options = await supportFormOptions(teacherCtx("Amit"));
    expect(options.students.map((row) => row.value)).toEqual([student.Rahul.id]);
    expect(options.subjectsByStudent![student.Rahul.id]).toEqual([{ value: mathsId, label: "Mathematics" }]);
  });

  it("a class teacher adds general support for their class, but not a subject they do not teach", async () => {
    await expect(createSupport(teacherCtx("Neha"), support({ studentId: student.Karan.id, subjectId: mathsId }))).rejects.toBeInstanceOf(ForbiddenError);
    await createSupport(teacherCtx("Neha"), support({ studentId: student.Karan.id }));
    await expect(createSupport(teacherCtx("Amit"), support({ studentId: student.Rahul.id }))).rejects.toBeInstanceOf(ForbiddenError);
    // A Commerce Maths teacher sees none of Amit's Science support.
    expect((await listSupport(teacherCtx("Ravi"))).map((row) => row.student)).not.toContain("Rahul Sharma");
  });
});

describe("substitute cover: on the dashboard only — concerns stay with the subject teacher", () => {
  it("the admin assigns a substitute; they see the period, not the students' concerns or support; removing it clears the period", async () => {
    // Amit is on leave today, and has a Maths period in 9-A today.
    await prisma.leaveRequest.create({ data: { schoolId: school.schoolId, teacherId: teacher.Amit.id, type: "CASUAL", startDate: today(), endDate: today(), reason: "Unwell", status: "APPROVED" } });
    const slot = await prisma.timetableSlot.create({
      data: { schoolId: school.schoolId, academicSessionId: school.academicSessionId, sectionId: sectionA, subjectId: mathsId, teacherId: teacher.Amit.id, dayOfWeek: dayOfWeek(today()), startMinute: 600, endMinute: 645 },
    });

    // The office sees who is away.
    const amitsRows = await listConcerns(adminOf(school), { status: "ALL", teacherId: teacher.Amit.id });
    expect(amitsRows.length).toBeGreaterThan(0);
    expect(amitsRows.every((row) => row.teacherOnLeave)).toBe(true);

    // The admin makes Ravi (Commerce Maths, not 9-A's class teacher) the substitute for that period.
    const cover = await assignSubstitute(adminOf(school), { timetableSlotId: slot.id, date: today(), teacherId: teacher.Ravi.id });

    // His dashboard shows: today, 10:00–10:45, Class 9 – A, Mathematics, covering for Amit.
    const plan = await getMyDayPlan(teacherCtx("Ravi"));
    expect(plan.periods.find((period) => period.coveringFor)).toMatchObject({ startMinute: 600, endMinute: 645, subject: "Mathematics", section: "Class 9 – A", coveringFor: "Amit Kumar" });
    expect((await getTeacherAlerts(teacherCtx("Ravi"))).some((alert) => alert.kind === "cover")).toBe(true);

    // …but none of Amit's students' concerns or support.
    const ravis = await listConcerns(teacherCtx("Ravi"), { status: "ALL" });
    expect(ravis.map((row) => row.id)).not.toContain(rahulConcernId);
    expect(ravis.every((row) => row.stream === "Commerce")).toBe(true);
    await expect(getConcern(teacherCtx("Ravi"), rahulConcernId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(replyToConcern(teacherCtx("Ravi"), { concernId: rahulConcernId, message: null, status: "RESOLVED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(raiseTeacherConcern(teacherCtx("Ravi"), { studentId: student.Rahul.id, subjectId: mathsId, type: "ACADEMIC", priority: "MEDIUM", message: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSupport(teacherCtx("Ravi"), support({ studentId: student.Rahul.id, subjectId: mathsId }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await teacherConcernOptions(teacherCtx("Ravi"))).map((row) => row.value)).not.toContain(student.Rahul.id);
    expect((await listSupport(teacherCtx("Ravi"), { subjectId: mathsId })).map((row) => row.student)).not.toContain("Rahul Sharma");

    // A parent's concern during the cover still reaches Amit, the subject teacher.
    const during = await raiseParentConcern(parentCtx("Rahul"), { studentId: student.Rahul.id, subjectId: mathsId, type: "ACADEMIC", message: "Question during Amit's leave." });
    expect(during.teacher).toBe("Amit Kumar");
    expect((await listConcerns(teacherCtx("Amit"), { status: "ALL" })).map((row) => row.id)).toContain(during.id);

    // The admin removes the substitute: the period leaves his dashboard.
    await clearSubstitute(adminOf(school), cover.id);
    expect((await getMyDayPlan(teacherCtx("Ravi"))).periods.some((period) => period.coveringFor)).toBe(false);
  });
});
