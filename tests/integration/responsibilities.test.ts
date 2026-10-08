/**
 * Responsibilities: Principal → assign → teacher/staff → complete → Principal
 * reviews.
 *
 *   * The Principal assigns a responsibility to a teacher; the teacher sees it,
 *     starts it, notes progress and marks it done; the Principal confirms it.
 *   * Overdue is computed from the due date; cancel and reassign are audited.
 *   * A teacher cannot assign, and cannot touch someone else's record.
 *   * Assignees are only this school's teachers, staff and Principal — never a
 *     parent, a student or another school's user.
 *   * The School Admin sees and manages everything — with or without a
 *     Principal; a Principal cannot review work given to themselves.
 *   * Holding a responsibility grants no access.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import type { ResponsibilityCreateInput } from "@/lib/validation/responsibilities";
import { responsibilityCreateSchema } from "@/lib/validation/responsibilities";
import { prisma } from "@/server/db/prisma";
import {
  assignablePeople,
  cancelResponsibility,
  completeResponsibility,
  confirmResponsibility,
  createResponsibility,
  listResponsibilities,
  myResponsibilities,
  responsibilitySummary,
  startResponsibility,
  updateResponsibility,
  updateResponsibilityProgress,
} from "@/server/responsibilities/service";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let principal: ReturnType<typeof contextFor>;
let otherTeacher: ReturnType<typeof contextFor>;

const input = (overrides: Partial<Record<keyof ResponsibilityCreateInput, unknown>> = {}): ResponsibilityCreateInput =>
  responsibilityCreateSchema.parse({ title: "Annual Sports Day", type: "SPORTS", assignedToId: schoolA.teacherUserId, startDate: "2026-10-01", endDate: "2026-12-31", priority: "HIGH", ...overrides });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.user.deleteMany({ where: { email: { contains: "@resp-test.test" } } });
  const p = await prisma.user.create({ data: { email: "p@resp-test.test", passwordHash: "x", role: "PRINCIPAL", firstName: "Meera", lastName: "Iyer", schoolId: schoolA.schoolId, activatedAt: new Date() } });
  principal = contextFor(schoolA, p.id, "PRINCIPAL");
  const t = await prisma.user.create({ data: { email: "t2@resp-test.test", passwordHash: "x", role: "TEACHER", firstName: "Second", lastName: "Teacher", schoolId: schoolA.schoolId, activatedAt: new Date() } });
  otherTeacher = contextFor(schoolA, t.id, "TEACHER");
}, 60_000);

afterAll(async () => {
  await prisma.responsibility.deleteMany({ where: { schoolId: { in: [schoolA.schoolId, schoolB.schoolId] } } });
  await prisma.user.deleteMany({ where: { email: { contains: "@resp-test.test" } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the Principal assigns, the teacher completes, the Principal confirms", () => {
  it("runs the whole flow, audited at each step", async () => {
    const people = await assignablePeople(principal);
    expect(people.map((person) => person.id)).toContain(schoolA.teacherUserId);
    expect(people.map((person) => person.id)).not.toContain(principal.user.id);

    const { id } = await createResponsibility(principal, input());
    const teacher = teacherOf(schoolA);
    const mine = await myResponsibilities(teacher);
    expect(mine.map((row) => row.id)).toContain(id);
    expect(mine.find((row) => row.id === id)).toMatchObject({ typeLabel: "Sports In-charge", assignedByName: "Meera Iyer" });

    await startResponsibility(teacher, id);
    await updateResponsibilityProgress(teacher, id, "Grounds booked, events listed.");
    await completeResponsibility(teacher, id);
    expect((await prisma.responsibility.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
    expect((await responsibilitySummary(principal)).all.awaitingReview).toBeGreaterThan(0);

    await confirmResponsibility(principal, id);
    expect((await prisma.responsibility.findUniqueOrThrow({ where: { id } })).confirmedAt).not.toBeNull();

    const actions = (await prisma.auditLog.findMany({ where: { entityId: id }, select: { action: true } })).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["RESPONSIBILITY_ASSIGNED", "RESPONSIBILITY_STARTED", "RESPONSIBILITY_PROGRESS", "RESPONSIBILITY_COMPLETED", "RESPONSIBILITY_CONFIRMED"]));
  });

  it("shows overdue work, and reassigning or cancelling is audited", async () => {
    const { id } = await createResponsibility(principal, input({ title: "PTM seating", type: "PTM_COORDINATOR", startDate: "2026-01-01", endDate: "2026-01-05" }));
    const overdue = await listResponsibilities(principal, "overdue");
    expect(overdue.find((row) => row.id === id)?.shownStatus).toBe("OVERDUE");

    const end = addDays(today(), 7);
    await updateResponsibility(principal, { ...input({ title: "PTM seating", type: "PTM_COORDINATOR", assignedToId: otherTeacher.user.id, startDate: "2026-01-01" }), endDate: end, responsibilityId: id });
    expect((await myResponsibilities(otherTeacher)).map((row) => row.id)).toContain(id);
    expect((await myResponsibilities(teacherOf(schoolA))).map((row) => row.id)).not.toContain(id);

    await cancelResponsibility(principal, id);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: id }, select: { action: true } })).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["RESPONSIBILITY_REASSIGNED", "RESPONSIBILITY_CANCELLED"]));
    await expect(completeResponsibility(otherTeacher, id)).rejects.toThrow(/cancelled/);
  });
});

describe("who may do what", () => {
  it("a teacher cannot assign, review, or touch someone else's record", async () => {
    await expect(createResponsibility(teacherOf(schoolA), input({ assignedToId: otherTeacher.user.id }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listResponsibilities(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    const { id } = await createResponsibility(principal, input({ title: "Lab stock check", type: "SCIENCE_LAB" }));
    await expect(completeResponsibility(otherTeacher, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmResponsibility(teacherOf(schoolA), id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelResponsibility(teacherOf(schoolA), id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("assignees are only this school's teachers, staff and Principal", async () => {
    await expect(createResponsibility(principal, input({ assignedToId: schoolA.parentUserId }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createResponsibility(principal, input({ assignedToId: schoolA.studentUserId }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createResponsibility(principal, input({ assignedToId: schoolB.teacherUserId }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createResponsibility(principal, input({ assignedToId: principal.user.id }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("holding a responsibility grants no access", async () => {
    await createResponsibility(principal, input({ title: "Exams", type: "EXAM_COORDINATOR" }));
    expect(can("TEACHER", "exams", "PUBLISH")).toBe(false);
    expect(can("TEACHER", "responsibilities", "CREATE")).toBe(false);
  });
});

describe("the School Admin oversees", () => {
  it("sees every record, gives the Principal work, and reviews it; the Principal cannot review their own", async () => {
    const admin = adminOf(schoolA);
    const all = await listResponsibilities(admin);
    expect(all.length).toBeGreaterThanOrEqual(3);

    const { id } = await createResponsibility(admin, input({ title: "Academic plan", type: "ACADEMIC", assignedToId: principal.user.id }));
    expect((await myResponsibilities(principal)).map((row) => row.id)).toContain(id);
    await completeResponsibility(principal, id);
    await expect(confirmResponsibility(principal, id)).rejects.toBeInstanceOf(ForbiddenError);
    await confirmResponsibility(admin, id);
  });

  it("works with no Principal at all (School B), and another school sees none of School A's records", async () => {
    const adminB = adminOf(schoolB);
    const { id } = await createResponsibility(adminB, responsibilityCreateSchema.parse({ title: "Discipline week", type: "DISCIPLINE", assignedToId: schoolB.teacherUserId, startDate: "2026-10-01" }));
    const rowsB = await listResponsibilities(adminB);
    expect(rowsB.map((row) => row.id)).toEqual([id]);
    await expect(confirmResponsibility(adminB, (await listResponsibilities(adminOf(schoolA)))[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
