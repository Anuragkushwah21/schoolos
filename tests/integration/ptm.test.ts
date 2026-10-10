/**
 * Simple PTMs: optional parent answers, a teacher's class-wise list, and the
 * attendance recorded afterwards — separate from the answer, with staff-only
 * notes. Checked for roles, tenants, class targeting and parent-child links.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, toDateInput, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { meetingSchema } from "@/lib/validation/meetings";
import { prisma } from "@/server/db/prisma";
import { saveMeeting } from "@/server/communication/meetings";
import { myPtmResponses, ptmClassList, recordPtmAttendance, respondToPtm } from "@/server/communication/ptm";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let upcomingId: string;
let pastId: string;
let otherSectionId: string;

const parentA = () => contextFor(schoolA, schoolA.parentUserId, "PARENT");
const parentB = () => contextFor(schoolB, schoolB.parentUserId, "PARENT");

async function ptm(date: Date, sectionIds: string[], extra: Record<string, unknown> = {}) {
  return (await prisma.meeting.create({ data: { schoolId: schoolA.schoolId, type: "PTM", title: "Term 1 PTM", date, startMinute: 600, endMinute: 720, audiences: ["PARENTS", "TEACHERS"], scope: "SECTIONS", sections: { create: sectionIds.map((sectionId) => ({ sectionId })) }, ...extra } })).id;
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  upcomingId = await ptm(addDays(today(), 5), [schoolA.sectionId]);
  pastId = await ptm(addDays(today(), -2), [schoolA.sectionId]);
  otherSectionId = schoolA.unassignedSectionId;
}, 60_000);

afterAll(async () => {
  await prisma.meeting.deleteMany({ where: { schoolId: schoolA.schoolId, title: { startsWith: "Term 1 PTM" } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("parent answers", () => {
  it("shows each child as not responded, saves an answer, and changes it — one row per child", async () => {
    const before = await myPtmResponses(parentA());
    expect(before[upcomingId]?.map((row) => row.response)).toEqual(schoolA.studentIds.map(() => null));
    const studentId = schoolA.studentIds[0]!;
    await respondToPtm(parentA(), { meetingId: upcomingId, studentId, response: "WILL_ATTEND" });
    await respondToPtm(parentA(), { meetingId: upcomingId, studentId, response: "UNABLE_TO_ATTEND" });
    await respondToPtm(parentA(), { meetingId: upcomingId, studentId, response: "UNABLE_TO_ATTEND" });
    expect(await prisma.ptmFamily.count({ where: { meetingId: upcomingId, studentId } })).toBe(1);
    expect((await myPtmResponses(parentA()))[upcomingId]?.find((row) => row.studentId === studentId)?.response).toBe("UNABLE_TO_ATTEND");
    expect(await prisma.auditLog.count({ where: { entityId: upcomingId, action: "PTM_RESPONSE_SAVED" } })).toBe(3);
  });

  it("only a linked parent, only for a child the PTM is for, only before it ends", async () => {
    // Another school's parent: the meeting and the child do not exist for them.
    await expect(respondToPtm(parentB(), { meetingId: upcomingId, studentId: schoolA.studentIds[0]!, response: "WILL_ATTEND" })).rejects.toBeInstanceOf(NotFoundError);
    // Their own child, but this school's PTM: not found.
    await expect(respondToPtm(parentB(), { meetingId: upcomingId, studentId: schoolB.studentIds[0]!, response: "WILL_ATTEND" })).rejects.toBeInstanceOf(NotFoundError);
    // A PTM for another section: not for this child.
    const elsewhere = await ptm(addDays(today(), 5), [otherSectionId], { title: "Term 1 PTM other" });
    await expect(respondToPtm(parentA(), { meetingId: elsewhere, studentId: schoolA.studentIds[0]!, response: "WILL_ATTEND" })).rejects.toBeInstanceOf(NotFoundError);
    // Over: answers are closed.
    await expect(respondToPtm(parentA(), { meetingId: pastId, studentId: schoolA.studentIds[0]!, response: "WILL_ATTEND" })).rejects.toBeInstanceOf(ConflictError);
    expect((await myPtmResponses(parentA()))[pastId]?.every((row) => !row.canRespond)).toBe(true);
    // A teacher or student cannot answer.
    await expect(respondToPtm(teacherOf(schoolA), { meetingId: upcomingId, studentId: schoolA.studentIds[0]!, response: "WILL_ATTEND" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("teacher's list and attendance", () => {
  it("the class teacher sees the class with each family's answer; nothing is recorded before the meeting", async () => {
    const list = await ptmClassList(teacherOf(schoolA), upcomingId);
    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]).toMatchObject({ sectionId: schoolA.sectionId, canRecord: true });
    expect(list.summary).toMatchObject({ families: schoolA.studentIds.length, unable: 1, notResponded: schoolA.studentIds.length - 1 });
    await expect(recordPtmAttendance(teacherOf(schoolA), { meetingId: upcomingId, studentId: schoolA.studentIds[0]!, attendance: "ATTENDED", remarks: null, followUp: null })).rejects.toThrow(/once the meeting has started/);
  });

  it("after the meeting: attendance is separate from the answer, notes stay with staff", async () => {
    const studentId = schoolA.studentIds[1]!;
    await prisma.ptmFamily.create({ data: { schoolId: schoolA.schoolId, meetingId: pastId, studentId, response: "WILL_ATTEND", respondedAt: new Date() } });
    await recordPtmAttendance(teacherOf(schoolA), { meetingId: pastId, studentId, attendance: "DID_NOT_ATTEND", remarks: "Mother called — unwell", followUp: "Call next week" });
    await recordPtmAttendance(teacherOf(schoolA), { meetingId: pastId, studentId, attendance: "RESCHEDULED", remarks: "Mother called — unwell", followUp: "Meet on Monday" });
    const row = await prisma.ptmFamily.findFirstOrThrow({ where: { meetingId: pastId, studentId } });
    expect(row).toMatchObject({ response: "WILL_ATTEND", attendance: "RESCHEDULED", followUp: "Meet on Monday" });
    expect(await prisma.ptmFamily.count({ where: { meetingId: pastId, studentId } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: pastId, action: "PTM_ATTENDANCE_RECORDED" }, orderBy: { createdAt: "desc" } });
    expect(audit.summary).toMatch(/Did not attend → Rescheduled/);
    expect(audit.summary).not.toMatch(/unwell/);

    // The family never sees the notes.
    expect(JSON.stringify(await myPtmResponses(parentA()))).not.toMatch(/unwell|Monday/);
    // A student or parent cannot open the staff list.
    await expect(ptmClassList(parentA(), pastId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ptmClassList(contextFor(schoolA, schoolA.studentUserId, "STUDENT"), pastId)).rejects.toBeInstanceOf(ForbiddenError);
    // The office sees and records everything.
    expect((await ptmClassList(adminOf(schoolA), pastId)).summary.recorded).toBe(1);
  });

  it("a teacher without the class sees nothing and cannot record; another school's staff cannot reach it", async () => {
    const user = await prisma.user.create({ data: { email: `ptm-teacher-${Date.now()}@ptm.test`, passwordHash: "x", role: "TEACHER", firstName: "No", lastName: "Class", schoolId: schoolA.schoolId } });
    await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: `PTM-${Date.now()}`, firstName: "No", lastName: "Class" } });
    const stranger = contextFor(schoolA, user.id, "TEACHER");
    // Not invited to this section's PTM at all.
    await expect(ptmClassList(stranger, pastId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordPtmAttendance(stranger, { meetingId: pastId, studentId: schoolA.studentIds[0]!, attendance: "ATTENDED", remarks: null, followUp: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(ptmClassList(adminOf(schoolB), pastId)).rejects.toBeInstanceOf(NotFoundError);
    await prisma.teacher.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe("cancelled and rescheduled PTMs", () => {
  it("a cancelled PTM takes no answers or records", async () => {
    const cancelled = await ptm(addDays(today(), 3), [schoolA.sectionId], { title: "Term 1 PTM cancelled", status: "CANCELLED", cancelledAt: new Date() });
    await expect(respondToPtm(parentA(), { meetingId: cancelled, studentId: schoolA.studentIds[0]!, response: "WILL_ATTEND" })).rejects.toThrow(/cancelled/);
    await expect(recordPtmAttendance(adminOf(schoolA), { meetingId: cancelled, studentId: schoolA.studentIds[0]!, attendance: "ATTENDED", remarks: null, followUp: null })).rejects.toThrow(/cancelled/);
  });

  it("moving a PTM to another day clears earlier answers, so families answer for the new time", async () => {
    const id = await saveMeeting(adminOf(schoolA), meetingSchema.parse({ type: "PTM", title: "Term 1 PTM moved", date: toDateInput(addDays(today(), 6)), startMinute: "10:00", endMinute: "12:00", audiences: ["PARENTS", "TEACHERS"], scope: "SECTIONS", sectionIds: [schoolA.sectionId] }));
    await respondToPtm(parentA(), { meetingId: id, studentId: schoolA.studentIds[0]!, response: "WILL_ATTEND" });
    // Saving with the same time keeps the answer…
    await saveMeeting(adminOf(schoolA), meetingSchema.parse({ meetingId: id, type: "PTM", title: "Term 1 PTM moved", description: "Bring the diary", date: toDateInput(addDays(today(), 6)), startMinute: "10:00", endMinute: "12:00", audiences: ["PARENTS", "TEACHERS"], scope: "SECTIONS", sectionIds: [schoolA.sectionId] }));
    expect((await prisma.ptmFamily.findFirstOrThrow({ where: { meetingId: id } })).response).toBe("WILL_ATTEND");
    // …a new day clears it.
    await saveMeeting(adminOf(schoolA), meetingSchema.parse({ meetingId: id, type: "PTM", title: "Term 1 PTM moved", date: toDateInput(addDays(today(), 8)), startMinute: "10:00", endMinute: "12:00", audiences: ["PARENTS", "TEACHERS"], scope: "SECTIONS", sectionIds: [schoolA.sectionId] }));
    expect((await prisma.ptmFamily.findFirstOrThrow({ where: { meetingId: id } })).response).toBeNull();
  });
});
