/**
 * Admission drives: the School Admin opens admissions, hands a class to a
 * teacher with their own dates, capacity and permissions, and keeps the
 * final decision.
 *
 *   * Teacher: create (draft) → documents → submit → pending admin review;
 *     admin: request correction → teacher fixes and resubmits → approve →
 *     the student is admitted through the usual admission.
 *   * Only the assigned teacher sees and works on it; each action needs its
 *     permission; the end date passing (or a pause) ends write access while
 *     viewing stays; extending gives it back.
 *   * Capacity is enforced on the server, also under parallel clicks.
 *   * Changing the teacher, reassigning and removing never delete an
 *     application; every step is in the audit log.
 *   * Office staff cannot decide a drive application; another school sees
 *     nothing of it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { driveApplicationSchema } from "@/lib/validation/admission-drives";
import type { TenantContext } from "@/server/auth/current-user";
import {
  addAdmissionDocument,
  createDriveApplication,
  extendAssignment,
  getDrive,
  getMyApplication,
  myAdmissionWork,
  readAdmissionDocument,
  reassignApplications,
  removeAssignment,
  reviewDriveApplication,
  saveAssignment,
  saveDrive,
  setAssignmentPaused,
  submitDriveApplication,
  updateDriveApplication,
} from "@/server/admissions/drives";
import { acceptApplication, listApplications, setApplicationStatus } from "@/server/admissions/service";
import { prisma } from "@/server/db/prisma";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let driveId: string;
let assignmentId: string;
let teacher2: { id: string; ctx: TenantContext };
let receptionist: TenantContext;

const ALL = ["view", "create", "edit", "documents", "submit"];
const day = (offset: number) => addDays(today(), offset);
const PDF = () => new File([Buffer.from("%PDF-1.4\n% admission test\n")], "birth-certificate.pdf", { type: "application/pdf" });

function child(firstName: string, extra: Record<string, string> = {}) {
  return driveApplicationSchema.parse({ studentFirstName: firstName, studentLastName: "Mehta", parentName: "Kiran Mehta", parentPhone: "+91 93333 44444", ...extra });
}

async function assignmentInput(overrides: Partial<{ assignmentId: string; teacherId: string; startDate: Date; endDate: Date; capacity: number; permissions: string[]; sectionId: string | null }> = {}) {
  return {
    driveId,
    classId: schoolA.classId,
    sectionId: schoolA.sectionId,
    teacherId: schoolA.teacherId,
    startDate: day(-5),
    endDate: day(10),
    capacity: 3,
    permissions: ALL,
    ...overrides,
  } as Parameters<typeof saveAssignment>[1];
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const user = await prisma.user.create({ data: { email: "drive-t2@drive-test.test", passwordHash: "x", role: "TEACHER", firstName: "Ravi", lastName: "Kumar", schoolId: schoolA.schoolId } });
  const row = await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "DRV-T2", firstName: "Ravi", lastName: "Kumar" } });
  teacher2 = { id: row.id, ctx: contextFor(schoolA, user.id, "TEACHER") };
  const staffUser = await prisma.user.create({ data: { email: "drive-rec@drive-test.test", passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: "Desk", lastName: "Person", schoolId: schoolA.schoolId } });
  await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: staffUser.id, employeeId: "DRV-REC", firstName: "Desk", lastName: "Person", role: "RECEPTIONIST", grants: ["admissions.view", "admissions.manage"] } });
  receptionist = contextFor(schoolA, staffUser.id, "NON_TEACHING_STAFF");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("setting up a drive", () => {
  it("only the School Admin creates drives and assignments", async () => {
    await expect(saveDrive(teacherOf(schoolA), { driveId: null, academicSessionId: schoolA.academicSessionId, name: "X", startDate: day(-10), endDate: day(30), status: "ACTIVE", notes: null })).rejects.toBeInstanceOf(ForbiddenError);
    driveId = await saveDrive(adminOf(schoolA), { driveId: null, academicSessionId: schoolA.academicSessionId, name: "Admissions 2027", startDate: day(-10), endDate: day(30), status: "ACTIVE", notes: null });
    assignmentId = await saveAssignment(adminOf(schoolA), await assignmentInput());
    await expect(saveAssignment(teacherOf(schoolA), await assignmentInput())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps the teacher's dates inside the drive's, and separate from them", async () => {
    await expect(saveAssignment(adminOf(schoolA), await assignmentInput({ endDate: day(45) }))).rejects.toBeInstanceOf(ValidationError);
    const drive = await getDrive(adminOf(schoolA), driveId);
    expect(drive.assignments[0]).toMatchObject({ state: "OPEN", capacity: 3, used: 0 });
    expect(drive.assignments[0]!.endDate.getTime()).not.toBe(drive.endDate.getTime());
  });
});

describe("the teacher's work", () => {
  let applicationId: string;

  it("sees only their own assignment", async () => {
    expect((await myAdmissionWork(teacherOf(schoolA))).assignments.map((row) => row.id)).toEqual([assignmentId]);
    expect((await myAdmissionWork(teacher2.ctx)).assignments).toEqual([]);
    await expect(createDriveApplication(teacher2.ctx, assignmentId, child("Nope"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates a draft, edits it, adds a document and submits — pending admin review", async () => {
    applicationId = await createDriveApplication(teacherOf(schoolA), assignmentId, child("Aditi"));
    let row = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(row).toMatchObject({ status: "DRAFT", source: "DRIVE", requestedClassId: schoolA.classId, assignmentId, driveId });
    await updateDriveApplication(teacherOf(schoolA), applicationId, child("Aditi", { previousSchool: "Little Stars" }));
    await addAdmissionDocument(teacherOf(schoolA), { applicationId, label: "Birth certificate", file: PDF() });
    await submitDriveApplication(teacherOf(schoolA), applicationId);
    row = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(row).toMatchObject({ status: "SUBMITTED", previousSchool: "Little Stars" });
    // Submitted: no more changes from the teacher.
    await expect(updateDriveApplication(teacherOf(schoolA), applicationId, child("Changed"))).rejects.toBeInstanceOf(ConflictError);
    expect((await getMyApplication(teacherOf(schoolA), applicationId)).application.documents).toHaveLength(1);
  });

  it("office staff cannot decide it; the admin sends it back, the teacher corrects, the admin approves and admits", async () => {
    await expect(setApplicationStatus(receptionist, { applicationId, status: "APPROVED", reviewNotes: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reviewDriveApplication(receptionist, { applicationId, decision: "APPROVE", note: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reviewDriveApplication(adminOf(schoolA), { applicationId, decision: "REQUEST_CORRECTION", note: null })).rejects.toBeInstanceOf(ValidationError);

    await reviewDriveApplication(adminOf(schoolA), { applicationId, decision: "REQUEST_CORRECTION", note: "Add the date of birth" });
    expect((await getMyApplication(teacherOf(schoolA), applicationId)).can).toMatchObject({ edit: true, submit: true });
    await updateDriveApplication(teacherOf(schoolA), applicationId, child("Aditi", { dateOfBirth: "2019-05-01" }));
    await submitDriveApplication(teacherOf(schoolA), applicationId);

    await reviewDriveApplication(adminOf(schoolA), { applicationId, decision: "APPROVE", note: null });
    const { studentId } = await acceptApplication(adminOf(schoolA), { applicationId, sectionId: schoolA.sectionId, rollNumber: null, admissionNumber: null, reviewNotes: null });
    expect(await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).toMatchObject({ firstName: "Aditi" });
    expect((await prisma.admissionApplication.findUniqueOrThrow({ where: { id: applicationId } })).status).toBe("CONVERTED");
  });

  it("documents reach the admin and the assigned teacher only", async () => {
    const [document] = (await getMyApplication(teacherOf(schoolA), applicationId)).application.documents;
    expect((await readAdmissionDocument(adminOf(schoolA), document!.id)).fileName).toBe("birth-certificate.pdf");
    await expect(readAdmissionDocument(teacher2.ctx, document!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readAdmissionDocument(adminOf(schoolB), document!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("capacity, on the server", () => {
  it("refuses past the capacity, counts a rejection as a freed place, and holds under parallel clicks", async () => {
    // 1 of 3 used (the admitted child). Two more fill it.
    const second = await createDriveApplication(teacherOf(schoolA), assignmentId, child("Bela"));
    await createDriveApplication(teacherOf(schoolA), assignmentId, child("Chirag"));
    await expect(createDriveApplication(teacherOf(schoolA), assignmentId, child("Full"))).rejects.toBeInstanceOf(ConflictError);

    await submitDriveApplication(teacherOf(schoolA), second);
    await reviewDriveApplication(adminOf(schoolA), { applicationId: second, decision: "REJECT", note: "Age criteria not met" });
    // One place free again; three clicks at once take it once.
    const results = await Promise.allSettled([1, 2, 3].map((n) => createDriveApplication(teacherOf(schoolA), assignmentId, child(`Race${n}`))));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await getDrive(adminOf(schoolA), driveId)).assignments[0]).toMatchObject({ used: 3, capacity: 3 });
  });

  it("cannot be lowered below the places already used", async () => {
    await expect(saveAssignment(adminOf(schoolA), await assignmentInput({ assignmentId, capacity: 2 }))).rejects.toBeInstanceOf(ValidationError);
    await saveAssignment(adminOf(schoolA), await assignmentInput({ assignmentId, capacity: 6 }));
  });
});

describe("access follows the dates, the pause and the permissions", () => {
  it("ends write access when the end date passes; viewing stays; extending restores it", async () => {
    const draft = (await myAdmissionWork(teacherOf(schoolA))).applications.find((row) => row.status === "DRAFT")!;
    await prisma.admissionAssignment.update({ where: { id: assignmentId }, data: { endDate: day(-1) } });
    await expect(createDriveApplication(teacherOf(schoolA), assignmentId, child("Late"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateDriveApplication(teacherOf(schoolA), draft.id, child("Late"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitDriveApplication(teacherOf(schoolA), draft.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getMyApplication(teacherOf(schoolA), draft.id)).can).toEqual({ edit: false, documents: false, submit: false });

    await extendAssignment(adminOf(schoolA), { assignmentId, endDate: day(5) });
    await updateDriveApplication(teacherOf(schoolA), draft.id, child("OnTime"));
  });

  it("not before the start date either", async () => {
    await prisma.admissionAssignment.update({ where: { id: assignmentId }, data: { startDate: day(2) } });
    await expect(createDriveApplication(teacherOf(schoolA), assignmentId, child("Early"))).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.admissionAssignment.update({ where: { id: assignmentId }, data: { startDate: day(-5) } });
  });

  it("pause and resume; drive paused stops it too", async () => {
    await setAssignmentPaused(adminOf(schoolA), assignmentId, true);
    await expect(createDriveApplication(teacherOf(schoolA), assignmentId, child("Paused"))).rejects.toBeInstanceOf(ForbiddenError);
    await setAssignmentPaused(adminOf(schoolA), assignmentId, false);
    await saveDrive(adminOf(schoolA), { driveId, academicSessionId: schoolA.academicSessionId, name: "Admissions 2027", startDate: day(-10), endDate: day(30), status: "PAUSED", notes: null });
    await expect(createDriveApplication(teacherOf(schoolA), assignmentId, child("Paused"))).rejects.toBeInstanceOf(ForbiddenError);
    await saveDrive(adminOf(schoolA), { driveId, academicSessionId: schoolA.academicSessionId, name: "Admissions 2027", startDate: day(-10), endDate: day(30), status: "ACTIVE", notes: null });
    await createDriveApplication(teacherOf(schoolA), assignmentId, child("Resumed"));
  });

  it("each action needs its own permission", async () => {
    await saveAssignment(adminOf(schoolA), await assignmentInput({ assignmentId, capacity: 6, endDate: day(5), permissions: ["view"] }));
    await expect(createDriveApplication(teacherOf(schoolA), assignmentId, child("NoCreate"))).rejects.toBeInstanceOf(ForbiddenError);
    const draft = (await myAdmissionWork(teacherOf(schoolA))).applications.find((row) => row.status === "DRAFT")!;
    await expect(addAdmissionDocument(teacherOf(schoolA), { applicationId: draft.id, label: "Report card", file: PDF() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitDriveApplication(teacherOf(schoolA), draft.id)).rejects.toBeInstanceOf(ForbiddenError);
    await saveAssignment(adminOf(schoolA), await assignmentInput({ assignmentId, capacity: 6, endDate: day(5) }));
  });
});

describe("changing hands never deletes anything", () => {
  it("changing the teacher moves the work to them; the old teacher loses it", async () => {
    const before = await prisma.admissionApplication.count({ where: { assignmentId } });
    await saveAssignment(adminOf(schoolA), await assignmentInput({ assignmentId, capacity: 6, endDate: day(5), teacherId: teacher2.id }));
    expect((await myAdmissionWork(teacherOf(schoolA))).assignments).toEqual([]);
    expect((await myAdmissionWork(teacher2.ctx)).applications).toHaveLength(before);
    expect(await prisma.admissionApplication.count({ where: { assignmentId } })).toBe(before);
    const audit = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "ADMISSION_ASSIGNMENT_UPDATED", entityId: assignmentId }, orderBy: { createdAt: "desc" } });
    expect(audit?.summary).toMatch(/teacher .* → Ravi Kumar/);
  });

  it("reassigns pending applications to another assignment, within its capacity, keeping each one", async () => {
    const other = await saveAssignment(adminOf(schoolA), await assignmentInput({ teacherId: schoolA.teacherId, sectionId: null, capacity: 1, endDate: day(5) }));
    const pending = await prisma.admissionApplication.count({ where: { assignmentId, status: { in: ["DRAFT", "SUBMITTED", "CORRECTION_REQUESTED"] } } });
    expect(pending).toBeGreaterThan(1);
    await expect(reassignApplications(adminOf(schoolA), { fromAssignmentId: assignmentId, toAssignmentId: other, applicationIds: [] })).rejects.toBeInstanceOf(ConflictError);
    await saveAssignment(adminOf(schoolA), await assignmentInput({ assignmentId: other, teacherId: schoolA.teacherId, sectionId: null, capacity: 10, endDate: day(5) }));
    const total = await prisma.admissionApplication.count({ where: { driveId } });
    expect(await reassignApplications(adminOf(schoolA), { fromAssignmentId: assignmentId, toAssignmentId: other, applicationIds: [] })).toBe(pending);
    expect(await prisma.admissionApplication.count({ where: { driveId } })).toBe(total);
    expect(await prisma.admissionApplication.count({ where: { assignmentId: other } })).toBe(pending);
    // Decided ones stay where they were.
    expect(await prisma.admissionApplication.count({ where: { assignmentId, status: { in: ["CONVERTED", "REJECTED"] } } })).toBeGreaterThan(0);
    expect((await myAdmissionWork(teacherOf(schoolA))).applications).toHaveLength(pending);
  });

  it("removing an assignment keeps it and its applications; the teacher loses access", async () => {
    const kept = await prisma.admissionApplication.count({ where: { assignmentId } });
    await removeAssignment(adminOf(schoolA), assignmentId);
    expect(await prisma.admissionAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).toMatchObject({ removedAt: expect.any(Date) });
    expect(await prisma.admissionApplication.count({ where: { assignmentId } })).toBe(kept);
    expect((await myAdmissionWork(teacher2.ctx)).assignments).toEqual([]);
  });

  it("records every step in the audit log", async () => {
    const actions = (await prisma.auditLog.findMany({ where: { schoolId: schoolA.schoolId, action: { startsWith: "ADMISSION_" } }, select: { action: true } })).map((row) => row.action);
    for (const action of ["ADMISSION_DRIVE_CREATED", "ADMISSION_ASSIGNMENT_CREATED", "ADMISSION_CREATED", "ADMISSION_SUBMITTED", "ADMISSION_CORRECTION_REQUESTED", "ADMISSION_DOCUMENT_ADDED", "ADMISSION_REASSIGNED", "ADMISSION_ASSIGNMENT_PAUSED", "ADMISSION_ASSIGNMENT_REMOVED"]) {
      expect(actions).toContain(action);
    }
  });
});

describe("tenant isolation", () => {
  it("another school sees nothing of this drive", async () => {
    await expect(getDrive(adminOf(schoolB), driveId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await myAdmissionWork(teacherOf(schoolB))).assignments).toEqual([]);
    expect((await listApplications(adminOf(schoolB), { origin: "drive" })).length).toBe(0);
    await expect(saveAssignment(adminOf(schoolB), await assignmentInput())).rejects.toBeInstanceOf(NotFoundError);
    // A school B teacher cannot be put on a school A drive either.
    await expect(saveAssignment(adminOf(schoolA), await assignmentInput({ teacherId: schoolB.teacherId }))).rejects.toBeInstanceOf(ValidationError);
  });
});
