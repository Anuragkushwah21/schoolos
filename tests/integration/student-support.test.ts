/**
 * Student support: teacher identifies and supports, parent raises concerns,
 * the office monitors and arranges an extra class, the student sees help —
 * and nobody reaches beyond their own classes, children or school.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { meetingSchema } from "@/lib/validation/meetings";
import { supportSchema } from "@/lib/validation/support";
import { myMeetings, saveMeeting } from "@/server/communication/meetings";
import { prisma } from "@/server/db/prisma";
import { getParentAlerts } from "@/server/parent/alerts";
import {
  createSupport,
  familySupport,
  followUpSupport,
  getSupport,
  listConcerns,
  listSupport,
  mySupport,
  raiseConcern,
  reviewConcern,
  supportSummary,
} from "@/server/support/service";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let otherTeacher: ReturnType<typeof contextFor>;
let scienceId: string;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");
const support = (overrides: Record<string, unknown>) =>
  supportSchema.parse({ reason: "NEEDS_PRACTICE", action: "EXTRA_PRACTICE", priority: "MEDIUM", ...overrides });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // A second teacher in school A who teaches none of these students.
  const user = await prisma.user.create({
    data: { email: `t2@iso-test-support.test`, passwordHash: "x", role: "TEACHER", firstName: "Other", lastName: "Teacher", schoolId: schoolA.schoolId },
  });
  await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "T-OTHER", firstName: "Other", lastName: "Teacher" } });
  otherTeacher = contextFor(schoolA, user.id, "TEACHER");
  scienceId = (await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "Science", code: "SCI" } })).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("teacher adds support", () => {
  it("for a student in their class, once per subject", async () => {
    const id = await createSupport(teacherOf(schoolA), support({ studentId: schoolA.studentIds[0], subjectId: schoolA.subjectId, topic: "Fractions" }));
    const row = await getSupport(teacherOf(schoolA), id);
    expect(row).toMatchObject({ source: "TEACHER", status: "IN_PROGRESS", subject: "Mathematics", topic: "Fractions" });
    await expect(createSupport(teacherOf(schoolA), support({ studentId: schoolA.studentIds[0], subjectId: schoolA.subjectId }))).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.auditLog.count({ where: { schoolId: schoolA.schoolId, action: "SUPPORT_CREATED", entityId: id } })).toBe(1);
  });

  it("but not for classes they don't teach, other schools, or without a reason", async () => {
    await expect(createSupport(otherTeacher, support({ studentId: schoolA.studentIds[1], subjectId: schoolA.subjectId }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSupport(teacherOf(schoolA), support({ studentId: schoolB.studentIds[0], subjectId: schoolA.subjectId }))).rejects.toBeInstanceOf(NotFoundError);
    expect(() => supportSchema.parse({ studentId: schoolA.studentIds[1], reason: "OTHER", action: "REVISION" })).toThrow();
    await expect(createSupport(parentOf(schoolA), support({ studentId: schoolA.studentIds[1] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is visible to the teachers of that class only", async () => {
    expect((await listSupport(teacherOf(schoolA))).length).toBe(1);
    expect(await listSupport(otherTeacher)).toEqual([]);
    const [row] = await listSupport(teacherOf(schoolA));
    await expect(getSupport(otherTeacher, row!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(followUpSupport(otherTeacher, { supportId: row!.id, note: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("parent concerns", () => {
  let concernId: string;

  it("reach the subject teacher, and never label the child by themselves", async () => {
    concernId = await raiseConcern(parentOf(schoolA), { studentId: schoolA.studentIds[1]!, subjectId: schoolA.subjectId, reason: "DIFFICULTY_UNDERSTANDING", message: "Finds fractions hard at home." });
    const concern = await prisma.supportConcern.findUniqueOrThrow({ where: { id: concernId } });
    expect(concern.teacherId).toBe(schoolA.teacherId);
    expect(await prisma.studentSupport.count({ where: { studentId: schoolA.studentIds[1] } })).toBe(0);
    await expect(raiseConcern(parentOf(schoolA), { studentId: schoolA.studentIds[1]!, subjectId: schoolA.subjectId, reason: "NEEDS_PRACTICE", message: null })).rejects.toBeInstanceOf(ConflictError);
    await expect(raiseConcern(parentOf(schoolB), { studentId: schoolA.studentIds[1]!, subjectId: null, reason: "OTHER", message: null })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listConcerns(teacherOf(schoolA))).map((row) => row.id)).toContain(concernId);
    expect(await listConcerns(otherTeacher)).toEqual([]);
  });

  it("are reviewed with a reply the parent sees — and nothing internal", async () => {
    await reviewConcern(teacherOf(schoolA), { concernId, status: "REVIEWING", response: "I'll give extra practice this week." });
    await expect(reviewConcern(otherTeacher, { concernId, status: "RESOLVED", response: null })).rejects.toBeInstanceOf(NotFoundError);
    const family = await familySupport(parentOf(schoolA));
    const mine = family.concerns.find((row) => row.id === concernId);
    expect(mine).toMatchObject({ status: "REVIEWING", response: "I'll give extra practice this week." });
    expect(Object.keys(mine!)).not.toContain("teacherId");
    const alerts = await getParentAlerts(parentOf(schoolA));
    expect(alerts.some((alert) => alert.kind === "support" && /reviewed/.test(alert.title))).toBe(true);
  });

  it("turn into support when the teacher decides, which marks the concern as acted on", async () => {
    const id = await createSupport(teacherOf(schoolA), support({ studentId: schoolA.studentIds[1], subjectId: schoolA.subjectId, reason: "PARENT_CONCERN", concernId }));
    expect(await getSupport(teacherOf(schoolA), id)).toMatchObject({ source: "PARENT", fromConcern: true });
    expect((await prisma.supportConcern.findUniqueOrThrow({ where: { id: concernId } })).status).toBe("ACTION_TAKEN");
    const family = await familySupport(parentOf(schoolA));
    expect(family.supports.find((row) => row.id === id)).toMatchObject({ subject: "Mathematics", action: "EXTRA_PRACTICE" });
    // Parents see the help, never staff notes or priority.
    expect(Object.keys(family.supports[0]!)).not.toContain("priority");
  });
});

describe("follow-up and the student's view", () => {
  it("moves to Improving, then Resolved, with the history kept", async () => {
    const [row] = await listSupport(teacherOf(schoolA), { subjectId: schoolA.subjectId });
    await followUpSupport(teacherOf(schoolA), { supportId: row!.id, note: "Did better in the last test.", status: "IMPROVING" });
    await followUpSupport(teacherOf(schoolA), { supportId: row!.id, note: null, status: "RESOLVED" });
    const detail = await getSupport(teacherOf(schoolA), row!.id);
    expect(detail.status).toBe("RESOLVED");
    expect(detail.resolvedAt).not.toBeNull();
    expect(detail.notes.map((note) => note.toStatus)).toEqual(["RESOLVED", "IMPROVING"]);
    expect(await prisma.auditLog.count({ where: { entityId: row!.id, action: "SUPPORT_RESOLVED" } })).toBe(1);
  });

  it("shows the student what they can do — no reason, priority or label", async () => {
    const rows = await mySupport(studentOf(schoolA));
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("reason");
      expect(Object.keys(row)).not.toContain("priority");
    }
    // Student 0's support was resolved above (list order is priority then age); none open for them now or one.
    expect(rows.every((row) => row.status !== "RESOLVED")).toBe(true);
    await expect(mySupport(parentOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the office", () => {
  it("monitors its own school, adds support and arranges an extra class", async () => {
    const summary = await supportSummary(adminOf(schoolA));
    expect(summary.students).toBeGreaterThanOrEqual(1);
    expect((await supportSummary(adminOf(schoolB))).students).toBe(0);

    const id = await createSupport(adminOf(schoolA), support({ studentId: schoolA.studentIds[0], subjectId: scienceId, action: "EXTRA_CLASS", teacherId: schoolA.teacherId }));
    expect(await getSupport(adminOf(schoolA), id)).toMatchObject({ source: "SCHOOL_ADMIN", status: "NEW", teacherId: schoolA.teacherId });
    await expect(getSupport(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listSupport(parentOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSupport(adminOf(schoolA), support({ studentId: schoolA.studentIds[2], teacherId: schoolB.teacherId }))).rejects.toBeInstanceOf(ValidationError);

    // The extra class is a meeting for the student, their parents and the teacher.
    const meetingId = await saveMeeting(
      adminOf(schoolA),
      meetingSchema.parse({
        title: "Extra class: Science",
        date: toDateInput(addDays(today(), 2)),
        startMinute: "14:00",
        endMinute: "15:00",
        audiences: ["STUDENTS", "PARENTS", "TEACHERS"],
        scope: "PEOPLE",
        studentAdmissionNumbers: "ADM1",
        teacherIds: [schoolA.teacherId],
        supportId: id,
      }),
    );
    const linked = await getSupport(adminOf(schoolA), id);
    expect(linked.status).toBe("IN_PROGRESS");
    expect(linked.extraClass?.id).toBe(meetingId);
    expect((await myMeetings(studentOf(schoolA))).upcoming.map((row) => row.id)).toContain(meetingId);
    expect((await mySupport(studentOf(schoolA))).some((row) => row.extraClass)).toBe(true);
  });

  it("support is only for current students", async () => {
    await prisma.student.update({ where: { id: schoolA.studentIds[2] }, data: { status: "TRANSFERRED" } });
    await expect(createSupport(teacherOf(schoolA), support({ studentId: schoolA.studentIds[2], subjectId: schoolA.subjectId }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(raiseConcern(parentOf(schoolA), { studentId: schoolA.studentIds[2]!, subjectId: null, reason: "OTHER", message: null })).rejects.toBeInstanceOf(NotFoundError);
  });
});
