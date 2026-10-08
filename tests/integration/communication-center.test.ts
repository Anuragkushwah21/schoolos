/**
 * The Communication Center, on top of the existing notices, notifications,
 * events and meetings.
 *
 *   * A notice can be a notice, an announcement or an emergency alert, and can
 *     target the whole school, a role, a class, a section — or a stream.
 *   * A stream message reaches that stream's students and parents and the
 *     teachers of sections with that stream; nobody else.
 *   * An emergency alert is also a critical notification for exactly the
 *     people it reaches, with the usual read state.
 *   * Only the School Admin sends; another school's stream is refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { type NoticeInput, noticeSchema } from "@/lib/validation/communication";
import { markAlertsRead, notificationCenter } from "@/server/alerts/center";
import type { TenantContext } from "@/server/auth/current-user";
import { communicationSummary, markNoticesRead, myNotices, saveNotice } from "@/server/communication/notices";
import { prisma } from "@/server/db/prisma";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let science: string;
let scienceB: string;
let sciStudent: TenantContext;
let comStudent: TenantContext;
let sciParent: TenantContext;
let streamTeacher: TenantContext;
let staff: TenantContext;

function notice(extra: Record<string, unknown>): NoticeInput {
  return noticeSchema.parse({ title: "Lab closed", body: "The science lab is closed tomorrow.", audience: "ALL", status: "PUBLISHED", scope: "SCHOOL", ...extra });
}

async function user(key: string, role: "STUDENT" | "PARENT" | "TEACHER" | "NON_TEACHING_STAFF") {
  return prisma.user.create({ data: { email: `${key}@cc-test.test`, passwordHash: "x", role, firstName: key, lastName: "C", schoolId: schoolA.schoolId } });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const schoolId = schoolA.schoolId;
  const klass = await prisma.class.create({ data: { schoolId, name: "Class 11", level: 11 } });
  const section = await prisma.section.create({ data: { schoolId, academicSessionId: schoolA.academicSessionId, classId: klass.id, name: "A" } });
  science = (await prisma.stream.create({ data: { schoolId, name: "Science" } })).id;
  const commerce = (await prisma.stream.create({ data: { schoolId, name: "Commerce" } })).id;
  scienceB = (await prisma.stream.create({ data: { schoolId: schoolB.schoolId, name: "Science" } })).id;
  await prisma.sectionStream.createMany({ data: [science, commerce].map((streamId) => ({ schoolId, sectionId: section.id, streamId, capacity: 30 })) });

  const enrol = async (key: string, streamId: string) => {
    const login = await user(key, "STUDENT");
    const student = await prisma.student.create({ data: { schoolId, userId: login.id, admissionNumber: `CC-${key}`, firstName: key, lastName: "C" } });
    await prisma.studentEnrollment.create({ data: { schoolId, studentId: student.id, academicSessionId: schoolA.academicSessionId, classId: klass.id, sectionId: section.id, streamId } });
    return { ctx: contextFor(schoolA, login.id, "STUDENT"), id: student.id };
  };
  const sci = await enrol("sci", science);
  sciStudent = sci.ctx;
  comStudent = (await enrol("com", commerce)).ctx;
  const parentLogin = await user("par", "PARENT");
  const parent = await prisma.parent.create({ data: { schoolId, userId: parentLogin.id, firstName: "P", lastName: "C", phone: "+91 95555 44444" } });
  await prisma.parentStudent.create({ data: { schoolId, parentId: parent.id, studentId: sci.id, relationship: "GUARDIAN", isPrimary: true } });
  sciParent = contextFor(schoolA, parentLogin.id, "PARENT");

  const teacherLogin = await user("tch", "TEACHER");
  const teacher = await prisma.teacher.create({ data: { schoolId, userId: teacherLogin.id, employeeId: "CC-T", firstName: "T", lastName: "C" } });
  await prisma.teacherSubjectAssignment.create({ data: { schoolId, academicSessionId: schoolA.academicSessionId, teacherId: teacher.id, subjectId: schoolA.subjectId, sectionId: section.id } });
  streamTeacher = contextFor(schoolA, teacherLogin.id, "TEACHER");
  const staffLogin = await user("stf", "NON_TEACHING_STAFF");
  await prisma.staffMember.create({ data: { schoolId, userId: staffLogin.id, employeeId: "CC-S", firstName: "S", lastName: "C", role: "SECURITY" } });
  staff = contextFor(schoolA, staffLogin.id, "NON_TEACHING_STAFF");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

const sees = async (ctx: TenantContext, id: string) => (await myNotices(ctx)).live.some((row) => row.id === id);

describe("audiences", () => {
  it("a stream message reaches that stream's students, parents and teachers only", async () => {
    const id = await saveNotice(adminOf(schoolA), notice({ kind: "ANNOUNCEMENT", scope: "STREAM", streamId: science }));
    expect(await sees(sciStudent, id)).toBe(true);
    expect(await sees(sciParent, id)).toBe(true);
    expect(await sees(streamTeacher, id)).toBe(true);
    expect(await sees(comStudent, id)).toBe(false);
    // The fixture teacher teaches Class 10 only.
    expect(await sees(teacherOf(schoolA), id)).toBe(false);
    expect(await sees(staff, id)).toBe(false);
    expect(await sees(adminOf(schoolA), id)).toBe(true);
  });

  it("role audiences still narrow it: Parents + stream is not for the students", async () => {
    const id = await saveNotice(adminOf(schoolA), notice({ audience: "PARENTS", scope: "STREAM", streamId: science }));
    expect(await sees(sciParent, id)).toBe(true);
    expect(await sees(sciStudent, id)).toBe(false);
  });

  it("staff messages go to the whole school only; another school's stream is refused", async () => {
    expect(() => notice({ audience: "NON_TEACHING_STAFF", scope: "STREAM", streamId: science })).toThrow();
    const staffNotice = await saveNotice(adminOf(schoolA), notice({ audience: "NON_TEACHING_STAFF" }));
    expect(await sees(staff, staffNotice)).toBe(true);
    expect(await sees(sciStudent, staffNotice)).toBe(false);
    await expect(saveNotice(adminOf(schoolA), notice({ scope: "STREAM", streamId: scienceB }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveNotice(teacherOf(schoolA), notice({}))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("emergency alerts", () => {
  it("are critical notifications for exactly the people they reach, with read state", async () => {
    const id = await saveNotice(adminOf(schoolA), notice({ kind: "EMERGENCY", title: "School closed — heavy rain", audience: "PARENTS" }));
    const parent = await notificationCenter(sciParent);
    const alert = parent.alerts.find((row) => row.key === `emergency:${id}`);
    expect(alert).toMatchObject({ tone: "critical", read: false });
    expect((await notificationCenter(sciStudent)).alerts.some((row) => row.key === `emergency:${id}`)).toBe(false);
    await markAlertsRead(sciParent, { keys: [`emergency:${id}`] });
    expect((await notificationCenter(sciParent)).alerts.find((row) => row.key === `emergency:${id}`)?.read).toBe(true);
    // And first on the notices page.
    expect((await myNotices(sciParent)).live[0]?.id).toBe(id);
  });

  it("the hub counts live messages by kind; only the School Admin sees it", async () => {
    const summary = await communicationSummary(adminOf(schoolA));
    expect(summary.live.EMERGENCY).toBe(1);
    expect(summary.live.ANNOUNCEMENT).toBeGreaterThanOrEqual(1);
    expect(summary.emergencies[0]?.title).toMatch(/heavy rain/);
    await expect(communicationSummary(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await communicationSummary(adminOf(schoolB))).live.EMERGENCY).toBe(0);
  });

  it("notice read / unread works as before", async () => {
    const before = (await myNotices(sciStudent)).unread;
    expect(before).toBeGreaterThan(0);
    await markNoticesRead(sciStudent, "ALL");
    expect((await myNotices(sciStudent)).unread).toBe(0);
  });
});
