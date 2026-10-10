/**
 * The unified calendar: one read layer over meetings, events, exams, class
 * tests and holidays — each item reaches exactly its audience, on the
 * server, with cancelled, draft and rescheduled items handled, and never
 * twice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, toDateInput, today } from "@/lib/dates";
import { schoolNow } from "@/lib/time-status";
import { meetingSchema } from "@/lib/validation/meetings";
import { getCalendarEntries, upcomingEntries } from "@/server/calendar/entries";
import { cancelMeeting, saveMeeting } from "@/server/communication/meetings";
import { prisma } from "@/server/db/prisma";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "calt";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
const from = () => today();
const to = () => addDays(today(), 30);
const day = (n: number) => toDateInput(addDays(today(), n));
const titles = async (ctx: Parameters<typeof getCalendarEntries>[0]) => (await getCalendarEntries(ctx, from(), to())).map((entry) => entry.title);

let otherParent: ReturnType<typeof contextFor>;
let strangerTeacher: ReturnType<typeof contextFor>;
let staff: ReturnType<typeof contextFor>;
const student = () => contextFor(schoolA, schoolA.studentUserId, "STUDENT");
const parent = () => contextFor(schoolA, schoolA.parentUserId, "PARENT");

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // A family whose child is in the other section.
  const user = await prisma.user.create({ data: { email: `parent@${PREFIX}.test`, passwordHash: "x", role: "PARENT", firstName: "Other", lastName: "Parent", schoolId: schoolA.schoolId } });
  const otherFamily = await prisma.parent.create({ data: { schoolId: schoolA.schoolId, userId: user.id, firstName: "Other", lastName: "Parent", phone: "+91 9000033333" } });
  const child = await prisma.student.create({ data: { schoolId: schoolA.schoolId, admissionNumber: `${PREFIX}-1`, firstName: "Elsewhere", lastName: "Child" } });
  await prisma.parentStudent.create({ data: { schoolId: schoolA.schoolId, parentId: otherFamily.id, studentId: child.id, relationship: "MOTHER", isPrimary: true } });
  const section = await prisma.section.findUniqueOrThrow({ where: { id: schoolA.unassignedSectionId }, select: { classId: true } });
  await prisma.studentEnrollment.create({ data: { schoolId: schoolA.schoolId, studentId: child.id, academicSessionId: schoolA.academicSessionId, classId: section.classId, sectionId: schoolA.unassignedSectionId } });
  otherParent = contextFor(schoolA, user.id, "PARENT");
  // A teacher with no class, and a non-teaching staff member.
  const teacherUser = await prisma.user.create({ data: { email: `teacher@${PREFIX}.test`, passwordHash: "x", role: "TEACHER", firstName: "No", lastName: "Class", schoolId: schoolA.schoolId } });
  await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: teacherUser.id, employeeId: `${PREFIX}-T`, firstName: "No", lastName: "Class" } });
  strangerTeacher = contextFor(schoolA, teacherUser.id, "TEACHER");
  const staffUser = await prisma.user.create({ data: { email: `staff@${PREFIX}.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: "Gate", lastName: "Keeper", schoolId: schoolA.schoolId } });
  staff = contextFor(schoolA, staffUser.id, "NON_TEACHING_STAFF");
}, 60_000);

afterAll(async () => {
  await prisma.meeting.deleteMany({ where: { schoolId: schoolA.schoolId, title: { startsWith: "CAL" } } });
  await prisma.event.deleteMany({ where: { schoolId: schoolA.schoolId, title: { startsWith: "CAL" } } });
  await prisma.assessment.deleteMany({ where: { schoolId: schoolA.schoolId, name: { startsWith: "CAL" } } });
  await prisma.holiday.deleteMany({ where: { schoolId: schoolA.schoolId, title: { startsWith: "CAL" } } });
  await prisma.teacher.deleteMany({ where: { employeeId: `${PREFIX}-T` } });
  await prisma.studentEnrollment.deleteMany({ where: { student: { admissionNumber: `${PREFIX}-1` } } });
  await prisma.parentStudent.deleteMany({ where: { student: { admissionNumber: `${PREFIX}-1` } } });
  await prisma.student.deleteMany({ where: { admissionNumber: `${PREFIX}-1` } });
  await prisma.parent.deleteMany({ where: { phone: "+91 9000033333" } });
  await prisma.user.deleteMany({ where: { email: { contains: `@${PREFIX}.test` } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

const meeting = (overrides: Record<string, unknown>) =>
  meetingSchema.parse({ type: "GENERAL", title: "CAL meeting", date: day(5), startMinute: "11:00", endMinute: "12:00", audiences: ["TEACHERS", "STUDENTS", "PARENTS"], scope: "SECTIONS", sectionIds: [schoolA.sectionId], ...overrides });

describe("audience", () => {
  it("a meeting for a class's teachers, students and parents reaches each of them — and nobody else", async () => {
    await saveMeeting(adminOf(schoolA), meeting({ title: "CAL class meeting" }));
    for (const ctx of [adminOf(schoolA), teacherOf(schoolA), student(), parent()]) expect(await titles(ctx)).toContain("CAL class meeting");
    for (const ctx of [otherParent, strangerTeacher, staff, contextFor(schoolB, schoolB.parentUserId, "PARENT"), teacherOf(schoolB), adminOf(schoolB)]) expect(await titles(ctx)).not.toContain("CAL class meeting");
  });

  it("only the groups chosen: a parents-only meeting is not on the teacher's or student's calendar", async () => {
    await saveMeeting(adminOf(schoolA), meeting({ title: "CAL parents only", audiences: ["PARENTS"] }));
    expect(await titles(parent())).toContain("CAL parents only");
    expect(await titles(teacherOf(schoolA))).not.toContain("CAL parents only");
    expect(await titles(student())).not.toContain("CAL parents only");
  });

  it("chosen students: only those students' parents see it", async () => {
    const admission = (await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[0]! } })).admissionNumber;
    await saveMeeting(adminOf(schoolA), meeting({ title: "CAL one family", audiences: ["PARENTS"], scope: "PEOPLE", sectionIds: [], studentAdmissionNumbers: admission }));
    expect(await titles(parent())).toContain("CAL one family");
    expect(await titles(otherParent)).not.toContain("CAL one family");
  });

  it("class tests follow the section and the stream", async () => {
    const subject = await prisma.subject.findUniqueOrThrow({ where: { id: schoolA.subjectId } });
    const stream = await prisma.stream.create({ data: { schoolId: schoolA.schoolId, name: "CAL Science" } });
    const other = await prisma.stream.create({ data: { schoolId: schoolA.schoolId, name: "CAL Commerce" } });
    await prisma.studentEnrollment.updateMany({ where: { studentId: schoolA.studentIds[0]!, academicSessionId: schoolA.academicSessionId }, data: { streamId: stream.id } });
    const base = { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, sectionId: schoolA.sectionId, subjectId: subject.id, maxMarks: 20, date: addDays(today(), 3) };
    await prisma.assessment.createMany({ data: [{ ...base, name: "CAL whole class" }, { ...base, name: "CAL science only", streamId: stream.id }, { ...base, name: "CAL commerce only", streamId: other.id }] });
    const seen = await titles(student());
    expect(seen).toEqual(expect.arrayContaining([`${subject.name}: CAL whole class`, `${subject.name}: CAL science only`]));
    expect(seen).not.toContain(`${subject.name}: CAL commerce only`);
    expect(await titles(otherParent)).not.toContain(`${subject.name}: CAL whole class`);
    expect(await titles(teacherOf(schoolA))).toEqual(expect.arrayContaining([`${subject.name}: CAL whole class`, `${subject.name}: CAL commerce only`]));
    await prisma.studentEnrollment.updateMany({ where: { studentId: schoolA.studentIds[0]!, academicSessionId: schoolA.academicSessionId }, data: { streamId: null } });
  });
});

describe("lifecycle", () => {
  it("draft events stay with the office until published; holidays reach everyone", async () => {
    const event = await prisma.event.create({ data: { schoolId: schoolA.schoolId, title: "CAL sports day", date: addDays(today(), 4), startMinute: 540, location: "Ground", isPublished: false } });
    await prisma.holiday.create({ data: { schoolId: schoolA.schoolId, title: "CAL holiday", startDate: addDays(today(), 9), endDate: addDays(today(), 10) } });
    expect(await titles(student())).not.toContain("CAL sports day");
    expect((await getCalendarEntries(adminOf(schoolA), from(), to())).find((entry) => entry.title === "CAL sports day")?.draft).toBe(true);
    expect((await upcomingEntries(adminOf(schoolA), 30)).map((entry) => entry.title)).not.toContain("CAL sports day");
    await prisma.event.update({ where: { id: event.id }, data: { isPublished: true } });
    expect(await titles(student())).toContain("CAL sports day");
    for (const ctx of [student(), staff, teacherOf(schoolA)]) expect(await titles(ctx)).toContain("CAL holiday");
    expect(await titles(adminOf(schoolB))).not.toContain("CAL holiday");
  });

  it("a cancelled meeting is marked cancelled and leaves 'upcoming'; rescheduling shows only the new date", async () => {
    const id = await saveMeeting(adminOf(schoolA), meeting({ title: "CAL movable", date: day(6) }));
    await cancelMeeting(adminOf(schoolA), { meetingId: id, reason: "Rain" });
    const cancelled = (await getCalendarEntries(parent(), from(), to())).find((entry) => entry.title === "CAL movable");
    expect(cancelled).toMatchObject({ cancelled: true, link: null });
    expect((await upcomingEntries(parent(), 30)).map((entry) => entry.title)).not.toContain("CAL movable");
    // Saving a cancelled meeting with a new date reschedules it.
    await saveMeeting(adminOf(schoolA), meeting({ meetingId: id, title: "CAL movable", date: day(12) }));
    const rows = (await getCalendarEntries(parent(), from(), to())).filter((entry) => entry.title === "CAL movable");
    expect(rows).toHaveLength(1);
    expect(toDateInput(rows[0]!.startDate)).toBe(day(12));
    expect(rows[0]!.cancelled).toBe(false);
  });

  it("never lists anything twice, and keeps details (time, place, link, instructions)", async () => {
    await saveMeeting(adminOf(schoolA), meeting({ title: "CAL details", description: "Bring the report card", location: "Hall", meetingLink: "meet.google.com/abc-defg-hij" }));
    const rows = await getCalendarEntries(parent(), from(), to(), "/parent");
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(rows.find((row) => row.title === "CAL details")).toMatchObject({ startMinute: 660, endMinute: 720, location: "Hall", link: "https://meet.google.com/abc-defg-hij", description: "Bring the report card", href: "/parent/meetings" });
  });

  it("uses the school's date: a meeting today that has ended drops out of 'upcoming', one later today stays", async () => {
    const clock = schoolNow();
    const ended = await prisma.meeting.create({ data: { schoolId: schoolA.schoolId, title: "CAL ended today", date: clock.date, startMinute: 0, endMinute: 1, audiences: ["PARENTS"], scope: "SCHOOL" } });
    const later = await prisma.meeting.create({ data: { schoolId: schoolA.schoolId, title: "CAL later today", date: clock.date, startMinute: 1438, endMinute: 1439, audiences: ["PARENTS"], scope: "SCHOOL" } });
    const upcoming = (await upcomingEntries(parent(), 7)).map((entry) => entry.title);
    if (clock.minutes >= 1) expect(upcoming).not.toContain("CAL ended today");
    if (clock.minutes < 1438) expect(upcoming).toContain("CAL later today");
    // Both are still on today's calendar.
    expect(await titles(parent())).toEqual(expect.arrayContaining(["CAL ended today", "CAL later today"]));
    await prisma.meeting.deleteMany({ where: { id: { in: [ended.id, later.id] } } });
  });
});
