/**
 * Stream seat allocation, stream-aware subject assignments, subject-wise
 * parent–teacher concerns, and activation emails (delivery, failure,
 * resend) — with every path checked for tenant, stream and subject leaks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { STAFF_ROLES, staffSchema } from "@/lib/validation/operations";
import { concernReplySchema, parentConcernSchema } from "@/lib/validation/support";
import { createStudentSchema, createTeacherSchema } from "@/lib/validation/school";
import { groupSubjectTeachers, saveStreamAllocations, seatPlan } from "@/server/academics/streams";
import { updateSection } from "@/server/academics/structure";
import { getAdminAlerts, getTeacherAlerts } from "@/server/alerts/feeds";
import { activationEmailStatuses, redeemAccountLink } from "@/server/auth/account-links";
import { prisma } from "@/server/db/prisma";
import { setMailTransport } from "@/server/mail/mailer";
import { grantStaffPortal, saveStaff } from "@/server/operations/staff";
import { getParentAlerts } from "@/server/parent/alerts";
import { resetPortalPassword } from "@/server/people/accounts";
import { createStudent } from "@/server/people/students";
import { assignSubject, createTeacher, unassignSubject } from "@/server/people/teachers";
import {
  assignConcern,
  getConcern,
  listConcerns,
  parentConcernOptions,
  raiseParentConcern,
  raiseTeacherConcern,
  replyToConcern,
  requestConcernUpdate,
  teacherConcernOptions,
} from "@/server/support/concerns";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";
import { sentMail, tokenFrom } from "../helpers/mail";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let classId: string;
let sectionA: string;
let sectionB: string;
const stream: Record<"Science" | "Commerce" | "Arts" | "Agriculture", string> = { Science: "", Commerce: "", Arts: "", Agriculture: "" };
const subject: Record<"History" | "Accountancy" | "English", string> = { History: "", Accountancy: "", English: "" };
const teacher: Record<"Rahul" | "Amit" | "Neha", { id: string; userId: string }> = {} as never;
let seq = 0;

const as = (name: keyof typeof teacher) => contextFor(schoolA, teacher[name].userId, "TEACHER");

async function admit(sectionId: string, streamId?: string, parent?: { existingParentId: string }) {
  seq += 1;
  return createStudent(
    adminOf(schoolA),
    createStudentSchema.parse({
      firstName: "Kid",
      lastName: `Stream${seq}`,
      sectionId,
      streamId,
      admissionDate: "2026-06-01",
      ...(parent
        ? { guardianMode: "existing", existingParentId: parent.existingParentId }
        : { guardianMode: "new", parentFirstName: "Parent", parentLastName: `Stream${seq}`, parentPhone: `+91 97${String(20000000 + seq).slice(-8)}`, relationship: "FATHER" }),
    }),
  );
}

/** A parent login for a student's (first) parent, created directly. */
async function parentLogin(studentId: string) {
  const link = await prisma.parentStudent.findFirstOrThrow({ where: { studentId }, select: { parentId: true } });
  const user = await prisma.user.create({
    data: { email: `p-${link.parentId}@streams.test`, passwordHash: "x", role: "PARENT", firstName: "P", lastName: "Arent", schoolId: schoolA.schoolId, activatedAt: new Date() },
  });
  await prisma.parent.update({ where: { id: link.parentId }, data: { userId: user.id } });
  return { ctx: contextFor(schoolA, user.id, "PARENT"), parentId: link.parentId };
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  classId = (await prisma.class.create({ data: { schoolId: schoolA.schoolId, name: "Class 9", level: 9 } })).id;
  const base = { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, classId };
  sectionA = (await prisma.section.create({ data: { ...base, name: "A", capacity: 40 } })).id;
  sectionB = (await prisma.section.create({ data: { ...base, name: "B", capacity: 50 } })).id;
  for (const name of Object.keys(stream) as Array<keyof typeof stream>) {
    stream[name] = (await prisma.stream.create({ data: { schoolId: schoolA.schoolId, name } })).id;
  }
  for (const [name, code] of [["History", "HIS"], ["Accountancy", "ACC"], ["English", "ENG"]] as const) {
    subject[name] = (await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name, code } })).id;
  }
  for (const name of ["Rahul", "Amit", "Neha"] as const) {
    const user = await prisma.user.create({ data: { email: `${name.toLowerCase()}@streams.test`, passwordHash: "x", role: "TEACHER", firstName: name, lastName: "Teacher", schoolId: schoolA.schoolId, activatedAt: new Date() } });
    const row = await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: `S-${name}`, firstName: name, lastName: "Teacher" } });
    teacher[name] = { id: row.id, userId: user.id };
  }
  await prisma.admissionCounter.deleteMany({ where: { schoolId: schoolA.schoolId } });
}, 60_000);

afterAll(async () => {
  // Every user here belongs to school A, so the fixture's cascade removes them.
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------

describe("stream seat allocation", () => {
  it("splits Class 9-A's 40 seats 15 / 10 / 10 / 5, exactly", async () => {
    await saveStreamAllocations(adminOf(schoolA), sectionA, [
      { streamId: stream.Science, capacity: 15 },
      { streamId: stream.Commerce, capacity: 10 },
      { streamId: stream.Arts, capacity: 10 },
      { streamId: stream.Agriculture, capacity: 5 },
    ]);
    const plan = await seatPlan(adminOf(schoolA).db, sectionA);
    expect(plan).toMatchObject({ capacity: 40, allocated: 40, unallocated: 0 });
    expect(plan.allocations.map((row) => [row.name, row.capacity])).toEqual([["Agriculture", 5], ["Arts", 10], ["Commerce", 10], ["Science", 15]]);
  });

  it("keeps Section B independent: 50 seats, 20 / 15 / 15", async () => {
    await saveStreamAllocations(adminOf(schoolA), sectionB, [
      { streamId: stream.Science, capacity: 20 },
      { streamId: stream.Commerce, capacity: 15 },
      { streamId: stream.Arts, capacity: 15 },
    ]);
    const [a, b] = await Promise.all([seatPlan(adminOf(schoolA).db, sectionA), seatPlan(adminOf(schoolA).db, sectionB)]);
    expect(b).toMatchObject({ capacity: 50, allocated: 50 });
    expect(b.allocations.find((row) => row.name === "Science")?.capacity).toBe(20);
    expect(a.allocations.find((row) => row.name === "Science")?.capacity).toBe(15);
    expect(b.allocations.some((row) => row.name === "Agriculture")).toBe(false);
  });

  it("refuses more than the section's capacity, and shows what remains below it", async () => {
    const over = saveStreamAllocations(adminOf(schoolA), sectionA, [
      { streamId: stream.Science, capacity: 20 },
      { streamId: stream.Commerce, capacity: 15 },
      { streamId: stream.Arts, capacity: 10 },
    ]);
    await expect(over).rejects.toBeInstanceOf(ValidationError);
    await expect(over).rejects.toThrow("Stream allocation cannot exceed the section's total capacity.");
    // Unchanged by the refused save.
    expect((await seatPlan(adminOf(schoolA).db, sectionA)).allocated).toBe(40);

    const loose = (await prisma.section.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, classId, name: "C", capacity: 40 } })).id;
    await saveStreamAllocations(adminOf(schoolA), loose, [
      { streamId: stream.Science, capacity: 20 },
      { streamId: stream.Commerce, capacity: 15 },
    ]);
    expect(await seatPlan(adminOf(schoolA).db, loose)).toMatchObject({ allocated: 35, unallocated: 5 });
  });

  it("will not let the section shrink below its shares, or be one stream while shared", async () => {
    await expect(updateSection(adminOf(schoolA), sectionA, { name: "A", capacity: 30, streamId: null, classTeacherId: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateSection(adminOf(schoolA), sectionA, { name: "A", capacity: 40, streamId: stream.Science, classTeacherId: null })).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot be set up in another school's section", async () => {
    await expect(saveStreamAllocations(adminOf(schoolB), sectionA, [])).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveStreamAllocations(adminOf(schoolA), schoolB.sectionId, [])).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("admission into a stream", () => {
  it("needs a stream where the section is shared, and records it", async () => {
    await expect(admit(sectionA)).rejects.toBeInstanceOf(ValidationError);
    const { studentId } = await admit(sectionA, stream.Science);
    expect((await prisma.studentEnrollment.findFirstOrThrow({ where: { studentId } })).streamId).toBe(stream.Science);
  });

  it("refuses a stream the section does not offer, and a full stream — even posted directly", async () => {
    // Agriculture is not offered in Section B.
    await expect(admit(sectionB, stream.Agriculture)).rejects.toBeInstanceOf(ValidationError);
    await saveStreamAllocations(adminOf(schoolA), sectionA, [
      { streamId: stream.Science, capacity: 15 },
      { streamId: stream.Commerce, capacity: 10 },
      { streamId: stream.Arts, capacity: 10 },
      { streamId: stream.Agriculture, capacity: 1 },
    ]);
    await admit(sectionA, stream.Agriculture);
    const full = admit(sectionA, stream.Agriculture);
    await expect(full).rejects.toBeInstanceOf(ConflictError);
    await expect(full).rejects.toThrow(/Agriculture in Class 9 – A is full/);
    expect((await seatPlan(adminOf(schoolA).db, sectionA)).allocations.find((row) => row.name === "Agriculture")).toMatchObject({ occupied: 1, full: true });
  });

  it("never gives the last seats to more students than there are, at once", async () => {
    await saveStreamAllocations(adminOf(schoolA), sectionB, [
      { streamId: stream.Science, capacity: 20 },
      { streamId: stream.Commerce, capacity: 2 },
      { streamId: stream.Arts, capacity: 15 },
    ]);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => admit(sectionB, stream.Commerce)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(await prisma.studentEnrollment.count({ where: { sectionId: sectionB, streamId: stream.Commerce, status: "ACTIVE" } })).toBe(2);
    // Every failed admission rolled back: no student without a placement, no number burnt twice.
    const numbers = await prisma.student.findMany({ where: { schoolId: schoolA.schoolId }, select: { admissionNumber: true } });
    expect(new Set(numbers.map((row) => row.admissionNumber)).size).toBe(numbers.length);
  });

  it("frees a seat when a student leaves, and warns — never moves anyone — when a share is lowered", async () => {
    const commerce = await prisma.studentEnrollment.findFirstOrThrow({ where: { sectionId: sectionB, streamId: stream.Commerce }, select: { id: true } });
    await prisma.studentEnrollment.update({ where: { id: commerce.id }, data: { status: "WITHDRAWN" } });
    expect((await seatPlan(adminOf(schoolA).db, sectionB)).allocations.find((row) => row.name === "Commerce")).toMatchObject({ occupied: 1, remaining: 1 });
    await prisma.studentEnrollment.update({ where: { id: commerce.id }, data: { status: "ACTIVE" } });

    const { warnings } = await saveStreamAllocations(adminOf(schoolA), sectionB, [
      { streamId: stream.Science, capacity: 20 },
      { streamId: stream.Commerce, capacity: 1 },
      { streamId: stream.Arts, capacity: 15 },
    ]);
    expect(warnings).toEqual(["Current enrollment in Commerce exceeds the new capacity by 1 student. Existing student assignments will not be changed automatically."]);
    expect(await prisma.studentEnrollment.count({ where: { sectionId: sectionB, streamId: stream.Commerce, status: "ACTIVE" } })).toBe(2);
    // A share in use cannot be removed.
    await expect(saveStreamAllocations(adminOf(schoolA), sectionB, [{ streamId: stream.Science, capacity: 20 }])).rejects.toBeInstanceOf(ConflictError);
  });

  it("leaves a class without streams exactly as before", async () => {
    // A stream sent for a section without streams is simply not used.
    const { studentId } = await admit(schoolA.unassignedSectionId, stream.Science);
    expect((await prisma.studentEnrollment.findFirstOrThrow({ where: { studentId } })).streamId).toBeNull();
  });
});

// -----------------------------------------------------------------------------

let science: { studentId: string };
let commerce: { studentId: string };
let arts: { studentId: string };

describe("stream-aware subject assignments", () => {
  beforeAll(async () => {
    science = await admit(sectionA, stream.Science);
    commerce = await admit(sectionA, stream.Commerce);
    arts = await admit(sectionA, stream.Arts);
  });

  it("keeps 9-A Science Maths → Rahul and 9-A Commerce Maths → Amit apart", async () => {
    await assignSubject(adminOf(schoolA), { teacherId: teacher.Rahul.id, subjectId: schoolA.subjectId, sectionId: sectionA, streamId: stream.Science });
    await assignSubject(adminOf(schoolA), { teacherId: teacher.Amit.id, subjectId: schoolA.subjectId, sectionId: sectionA, streamId: stream.Commerce });
    await assignSubject(adminOf(schoolA), { teacherId: teacher.Amit.id, subjectId: subject.Accountancy, sectionId: sectionA, streamId: stream.Commerce });
    const rows = await prisma.teacherSubjectAssignment.findMany({ where: { sectionId: sectionA, subjectId: schoolA.subjectId }, select: { teacherId: true, streamId: true } });
    expect(rows).toHaveLength(2);
    const placement = { academicSessionId: schoolA.academicSessionId, sectionId: sectionA };
    expect(await groupSubjectTeachers(adminOf(schoolA).db, { ...placement, streamId: stream.Science }, schoolA.subjectId)).toEqual([teacher.Rahul.id]);
    expect(await groupSubjectTeachers(adminOf(schoolA).db, { ...placement, streamId: stream.Commerce }, schoolA.subjectId)).toEqual([teacher.Amit.id]);
    expect(await groupSubjectTeachers(adminOf(schoolA).db, { ...placement, streamId: stream.Arts }, schoolA.subjectId)).toEqual([]);
  });

  it("refuses duplicates (whole-section too) and a stream the section does not have", async () => {
    await expect(assignSubject(adminOf(schoolA), { teacherId: teacher.Rahul.id, subjectId: schoolA.subjectId, sectionId: sectionA, streamId: stream.Science })).rejects.toBeInstanceOf(ConflictError);
    await assignSubject(adminOf(schoolA), { teacherId: teacher.Neha.id, subjectId: subject.History, sectionId: sectionA, streamId: null });
    await expect(assignSubject(adminOf(schoolA), { teacherId: teacher.Neha.id, subjectId: subject.History, sectionId: sectionA, streamId: null })).rejects.toBeInstanceOf(ConflictError);
    await expect(assignSubject(adminOf(schoolA), { teacherId: teacher.Neha.id, subjectId: subject.History, sectionId: schoolA.unassignedSectionId, streamId: stream.Science })).rejects.toBeInstanceOf(ValidationError);
  });
});

// -----------------------------------------------------------------------------

describe("parent → teacher routing", () => {
  it("Science student + Maths → Rahul; Commerce student + Maths → Amit", async () => {
    const sci = await parentLogin(science.studentId);
    const com = await parentLogin(commerce.studentId);
    const a = await raiseParentConcern(sci.ctx, { studentId: science.studentId, subjectId: schoolA.subjectId, type: "TOPIC_DIFFICULTY", message: "Aarav is having difficulty with fractions." });
    const b = await raiseParentConcern(com.ctx, { studentId: commerce.studentId, subjectId: schoolA.subjectId, type: "HOMEWORK", message: "Too much homework." });
    expect(a.teacher).toBe("Rahul Teacher");
    expect(b.teacher).toBe("Amit Teacher");
    const row = await prisma.supportConcern.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ teacherId: teacher.Rahul.id, raisedBy: "PARENT", status: "OPEN", sectionId: sectionA, streamId: stream.Science, classId });
    // Numbered per school, in order.
    expect(b.number).toBe(a.number + 1);
    expect(a.ref).toMatch(/^CON-\d+$/);
  });

  it("uses a whole-section teacher only when nobody teaches the child's own stream", async () => {
    const artsParent = await parentLogin(arts.studentId);
    const history = await raiseParentConcern(artsParent.ctx, { studentId: arts.studentId, subjectId: subject.History, type: "ACADEMIC", message: "History dates." });
    expect(history.teacher).toBe("Neha Teacher");
    await assignSubject(adminOf(schoolA), { teacherId: teacher.Rahul.id, subjectId: subject.History, sectionId: sectionA, streamId: stream.Arts });
    const placement = { academicSessionId: schoolA.academicSessionId, sectionId: sectionA, streamId: stream.Arts };
    expect(await groupSubjectTeachers(adminOf(schoolA).db, placement, subject.History)).toEqual([teacher.Rahul.id]);
  });

  it("goes to the School Admin when no teacher is assigned — never to the class teacher", async () => {
    await prisma.section.update({ where: { id: sectionA }, data: { classTeacherId: teacher.Neha.id } });
    const sci = contextFor(schoolA, (await prisma.parent.findFirstOrThrow({ where: { children: { some: { studentId: science.studentId } } } })).userId!, "PARENT");
    const english = await raiseParentConcern(sci, { studentId: science.studentId, subjectId: subject.English, type: "OTHER", message: "Spelling." });
    expect(english.teacher).toBeNull();
    expect((await prisma.supportConcern.findUniqueOrThrow({ where: { id: english.id } })).teacherId).toBeNull();
    const office = await listConcerns(adminOf(schoolA), { assigned: "NONE" });
    expect(office.map((row) => row.id)).toContain(english.id);
    expect(office.find((row) => row.id === english.id)?.waitingOnMe).toBe(true);
    expect((await getAdminAlerts(adminOf(schoolA))).some((alert) => alert.kind === "concerns-office")).toBe(true);
    // The form says so before the parent sends it.
    const options = await parentConcernOptions(sci);
    expect(options[0]!.subjects.find((row) => row.value === subject.English)?.teacher).toBeNull();
    expect(options[0]!.subjects.find((row) => row.value === schoolA.subjectId)?.teacher).toBe("Rahul Teacher");
  });

  it("cannot be redirected: no teacher field, another school's child, or a child who is not theirs", async () => {
    const sci = contextFor(schoolA, (await prisma.parent.findFirstOrThrow({ where: { children: { some: { studentId: science.studentId } } } })).userId!, "PARENT");
    const parsed = parentConcernSchema.parse({ studentId: science.studentId, subjectId: schoolA.subjectId, type: "OTHER", message: "x", teacherId: teacher.Amit.id });
    expect(parsed).not.toHaveProperty("teacherId");
    await expect(raiseParentConcern(sci, { studentId: commerce.studentId, subjectId: schoolA.subjectId, type: "OTHER", message: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(raiseParentConcern(sci, { studentId: schoolB.studentIds[0]!, subjectId: schoolA.subjectId, type: "OTHER", message: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(raiseParentConcern(sci, { studentId: science.studentId, subjectId: schoolB.subjectId, type: "OTHER", message: "x" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("serves a parent with several children, each routed by their own group", async () => {
    const sci = await prisma.parent.findFirstOrThrow({ where: { children: { some: { studentId: science.studentId } } }, select: { id: true, userId: true } });
    const sibling = await admit(sectionA, stream.Commerce, { existingParentId: sci.id });
    const ctx = contextFor(schoolA, sci.userId!, "PARENT");
    const options = await parentConcernOptions(ctx);
    expect(options.map((row) => row.id).sort()).toEqual([science.studentId, sibling.studentId].sort());
    const concern = await raiseParentConcern(ctx, { studentId: sibling.studentId, subjectId: schoolA.subjectId, type: "ACADEMIC", message: "Sibling maths." });
    expect(concern.teacher).toBe("Amit Teacher");
  });
});

describe("teacher → parent, and who sees what", () => {
  it("lets Rahul raise Maths for Science students only", async () => {
    const created = await raiseTeacherConcern(as("Rahul"), { studentId: science.studentId, subjectId: schoolA.subjectId, type: "POSITIVE_FEEDBACK", priority: "LOW", message: "Great work on algebra." });
    expect((await prisma.supportConcern.findUniqueOrThrow({ where: { id: created.id } })).parentId).toBeNull();
    await expect(raiseTeacherConcern(as("Rahul"), { studentId: commerce.studentId, subjectId: schoolA.subjectId, type: "OTHER", priority: "LOW", message: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(raiseTeacherConcern(as("Rahul"), { studentId: science.studentId, subjectId: subject.Accountancy, type: "OTHER", priority: "LOW", message: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(raiseTeacherConcern(as("Rahul"), { studentId: science.studentId, subjectId: subject.English, type: "OTHER", priority: "LOW", message: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(raiseTeacherConcern(as("Rahul"), { studentId: schoolB.studentIds[0]!, subjectId: schoolA.subjectId, type: "OTHER", priority: "LOW", message: "x" })).rejects.toBeInstanceOf(NotFoundError);
    // The form offers the same, and nothing more.
    const options = await teacherConcernOptions(as("Rahul"));
    expect(options.map((row) => row.value)).toContain(science.studentId);
    expect(options.map((row) => row.value)).not.toContain(commerce.studentId);
    // The parent is told.
    const sci = contextFor(schoolA, (await prisma.parent.findFirstOrThrow({ where: { children: { some: { studentId: science.studentId } } } })).userId!, "PARENT");
    const alerts = await getParentAlerts(sci);
    expect(alerts.some((alert) => alert.kind === "concern" && /^New Mathematics concern for /.test(alert.title))).toBe(true);
  });

  it("shows each teacher only their own concerns, and parents only their own children's", async () => {
    const rahul = await listConcerns(as("Rahul"), { status: "ALL" });
    const amit = await listConcerns(as("Amit"), { status: "ALL" });
    expect(rahul.every((row) => row.teacherId === teacher.Rahul.id)).toBe(true);
    expect(amit.every((row) => row.teacherId === teacher.Amit.id)).toBe(true);
    const amitsOne = amit[0]!;
    await expect(getConcern(as("Rahul"), amitsOne.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(replyToConcern(as("Rahul"), { concernId: amitsOne.id, message: "x" })).rejects.toBeInstanceOf(NotFoundError);
    const artsParent = contextFor(schoolA, (await prisma.parent.findFirstOrThrow({ where: { children: { some: { studentId: arts.studentId } } } })).userId!, "PARENT");
    await expect(getConcern(artsParent, amitsOne.id)).rejects.toBeInstanceOf(NotFoundError);
    // Another school sees none of it.
    expect(await listConcerns(adminOf(schoolB), { status: "ALL" })).toEqual([]);
    await expect(getConcern(adminOf(schoolB), amitsOne.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("moves by status only: the teacher updates, the parent reads, the office requests action", async () => {
    const [concern] = await listConcerns(as("Rahul"), { subjectId: schoolA.subjectId, raisedBy: "PARENT" });
    const parentCtx = contextFor(schoolA, (await prisma.parent.findFirstOrThrow({ where: { children: { some: { studentId: science.studentId } } } })).userId!, "PARENT");
    expect((await getTeacherAlerts(as("Rahul"))).some((alert) => /^New Mathematics concern from /.test(alert.title))).toBe(true);

    await replyToConcern(as("Rahul"), concernReplySchema.parse({ concernId: concern!.id, status: "IN_PROGRESS" }));
    expect((await getConcern(parentCtx, concern!.id)).status).toBe("IN_PROGRESS");
    // A parent cannot change the status, or post to it.
    await expect(replyToConcern(parentCtx, { concernId: concern!.id, message: null, status: "RESOLVED" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(replyToConcern(parentCtx, { concernId: concern!.id, message: "Thank you." })).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => concernReplySchema.parse({ concernId: concern!.id, status: "CLOSED" })).toThrow();

    await requestConcernUpdate(adminOf(schoolA), { concernId: concern!.id, note: null });
    const alerts = await getTeacherAlerts(as("Rahul"));
    expect(alerts.some((alert) => /^School Admin requested an update for .+'s Mathematics concern$/.test(alert.title))).toBe(true);
    await expect(requestConcernUpdate(as("Rahul"), { concernId: concern!.id, note: null })).rejects.toBeInstanceOf(ForbiddenError);
    // The family never sees the office's staff-only note.
    expect((await getConcern(parentCtx, concern!.id)).messages.some((message) => message.internal)).toBe(false);
    expect((await getConcern(as("Rahul"), concern!.id)).messages.some((message) => message.internal)).toBe(true);

    await replyToConcern(as("Rahul"), { concernId: concern!.id, message: "Extra practice has been provided.", status: "RESOLVED" });
    const resolved = await getConcern(parentCtx, concern!.id);
    expect(resolved).toMatchObject({ status: "RESOLVED", message: "Aarav is having difficulty with fractions." });
    expect((await getConcern(as("Rahul"), concern!.id)).updateRequested).toBe(false);
    expect((await getParentAlerts(parentCtx)).some((alert) => alert.title.startsWith("Teacher Rahul Teacher updated"))).toBe(true);
    expect((await listConcerns(adminOf(schoolA), { status: "RESOLVED" })).map((row) => row.id)).toContain(concern!.id);
  });

  it("filters for the office by stream, subject, teacher and who raised it", async () => {
    const byStream = await listConcerns(adminOf(schoolA), { status: "ALL", streamId: stream.Commerce });
    expect(byStream.length).toBeGreaterThan(0);
    expect(byStream.every((row) => row.stream === "Commerce")).toBe(true);
    const byTeacher = await listConcerns(adminOf(schoolA), { status: "ALL", raisedBy: "TEACHER", teacherId: teacher.Rahul.id });
    expect(byTeacher.map((row) => row.type)).toEqual(["POSITIVE_FEEDBACK"]);
    expect(byTeacher[0]!.group).toBe("Class 9 – A • Science");
  });

  it("keeps history when the subject teacher changes, and lets the admin hand one over", async () => {
    const before = await listConcerns(adminOf(schoolA), { status: "ALL", teacherId: teacher.Rahul.id, subjectId: schoolA.subjectId });
    const rahulsRow = await prisma.teacherSubjectAssignment.findFirstOrThrow({ where: { teacherId: teacher.Rahul.id, subjectId: schoolA.subjectId, streamId: stream.Science } });
    await unassignSubject(adminOf(schoolA), rahulsRow.id);
    await assignSubject(adminOf(schoolA), { teacherId: teacher.Amit.id, subjectId: schoolA.subjectId, sectionId: sectionA, streamId: stream.Science });

    const sci = contextFor(schoolA, (await prisma.parent.findFirstOrThrow({ where: { children: { some: { studentId: science.studentId } } } })).userId!, "PARENT");
    const october = await raiseParentConcern(sci, { studentId: science.studentId, subjectId: schoolA.subjectId, type: "ACADEMIC", message: "October question." });
    expect(october.teacher).toBe("Amit Teacher");
    const after = await listConcerns(adminOf(schoolA), { status: "ALL", teacherId: teacher.Rahul.id, subjectId: schoolA.subjectId });
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());

    const [waiting] = await listConcerns(adminOf(schoolA), { assigned: "NONE" });
    await assignConcern(adminOf(schoolA), { concernId: waiting!.id, teacherId: teacher.Neha.id });
    expect((await listConcerns(contextFor(schoolA, teacher.Neha.userId, "TEACHER"))).map((row) => row.id)).toContain(waiting!.id);
  });
});

// -----------------------------------------------------------------------------

describe("activation emails", () => {
  it("go to a new teacher and a new staff member, naming the role and the school", async () => {
    const { invite } = await createTeacher(adminOf(schoolA), createTeacherSchema.parse({ firstName: "Mail", lastName: "Teacher", email: "mail.teacher@streams.test", employeeId: "S-MAIL" }));
    expect(invite).toMatchObject({ delivered: true, email: "mail.teacher@streams.test" });
    const mail = [...sentMail].reverse().find((m) => m.to === "mail.teacher@streams.test")!;
    expect(mail.subject).toBe("Activate your SchoolOS account");
    expect(mail.text).toContain("Your teacher account has been created for Isolation Test School A.");
    // A link to choose a password — never a password itself.
    expect(mail.text).not.toMatch(/^\s*Password:/im);

    const staffId = await saveStaff(adminOf(schoolA), staffSchema.parse({ employeeId: "S-STAFF", firstName: "Office", lastName: "Staff", role: STAFF_ROLES[0] }));
    const staffInvite = await grantStaffPortal(adminOf(schoolA), staffId, "office.staff@streams.test");
    expect(staffInvite.delivered).toBe(true);
    expect([...sentMail].reverse().find((m) => m.to === "office.staff@streams.test")!.text).toContain("Your staff account has been created");
  });

  it("record a refused send with the provider's reason, keep the account, and resend", async () => {
    setMailTransport(async () => {
      throw new Error("Resend refused the message (403): You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain.");
    });
    const { teacherId, invite } = await createTeacher(adminOf(schoolA), createTeacherSchema.parse({ firstName: "Fail", lastName: "Mail", email: "fail.mail@streams.test", employeeId: "S-FAIL" }));
    expect(invite.delivered).toBe(false);
    expect(invite.error).toMatch(/test mode/);
    const user = await prisma.user.findFirstOrThrow({ where: { email: "fail.mail@streams.test" } });
    expect(user.activatedAt).toBeNull();
    expect(await prisma.teacher.count({ where: { id: teacherId } })).toBe(1);
    const status = (await activationEmailStatuses(adminOf(schoolA), [user.id])).get(user.id);
    expect(status).toMatchObject({ status: "FAILED" });
    expect(status!.error).toMatch(/verify your domain/i);
    // Nothing secret in what was stored.
    expect(status!.error).not.toMatch(/re_[A-Za-z0-9]{6,}/);

    // Resend once delivery works: a new link, the old one revoked, same account.
    setMailTransport(async (mail) => {
      sentMail.push(mail);
    });
    const resent = await resetPortalPassword(adminOf(schoolA), user.id);
    expect(resent).toMatchObject({ delivered: true, label: "Activation email" });
    expect(await prisma.user.count({ where: { email: "fail.mail@streams.test" } })).toBe(1);
    const tokens = await prisma.accountToken.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.revokedAt).not.toBeNull();
    expect((await activationEmailStatuses(adminOf(schoolA), [user.id])).get(user.id)).toMatchObject({ status: "SENT" });

    await redeemAccountLink(tokenFrom("fail.mail@streams.test", "activate"), "ACTIVATION", "Chosen-password-1", "Chosen-password-1");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).activatedAt).not.toBeNull();
    // Another school's admin cannot read or resend it.
    expect((await activationEmailStatuses(adminOf(schoolB), [user.id])).size).toBe(0);
    await expect(resetPortalPassword(adminOf(schoolB), user.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
