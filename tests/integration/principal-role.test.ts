/**
 * The Principal: a working school leader of one school — not a read-only
 * viewer, and not a second School Admin either.
 *
 *   * The permission table: the Principal adds and edits students and
 *     teachers, runs academics, attendance, exams and communication, and
 *     assigns responsibilities; finance is an overview only; deleting people,
 *     settings, staff access and platform work stay with the School Admin.
 *   * The Principal adds a student and a teacher, creates a notice, a PTM and
 *     an event, cancels the PTM, schedules an exam — and cannot publish
 *     results while marks are missing (the same rule as the School Admin).
 *   * The Principal cannot delete students or teachers, take or charge fees,
 *     pay salaries, change staff access or school settings, or manage the
 *     Principal login.
 *   * The School Admin decides who is Principal; the login waits for
 *     activation; a default password must be changed before use.
 *   * School B's Principal sees nothing of School A.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { AppError, ForbiddenError } from "@/lib/errors";
import { ROLE_PERMISSIONS, can } from "@/lib/permissions";
import { eventSchema, noticeSchema } from "@/lib/validation/communication";
import { createExamSchema } from "@/lib/validation/exams";
import { meetingSchema } from "@/lib/validation/meetings";
import { createStudentSchema, createTeacherSchema } from "@/lib/validation/school";
import { getPrincipalAlerts } from "@/server/alerts/feeds";
import { academicSnapshot, financeSnapshot } from "@/server/analytics/admin-dashboard";
import { saveAttendanceSettings } from "@/server/attendance/cover";
import { changePassword } from "@/server/auth/account";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { saveEvent } from "@/server/communication/events";
import { cancelMeeting, saveMeeting } from "@/server/communication/meetings";
import { saveNotice } from "@/server/communication/notices";
import { prisma } from "@/server/db/prisma";
import { createExams, listExams, publishExams } from "@/server/exams/service";
import { createFeeHead, listFeePositions, recordPayment } from "@/server/finance/fees";
import { payPayroll } from "@/server/finance/payroll";
import { setStaffGrants } from "@/server/operations/staff";
import { createPrincipal, listPrincipals, principalWorkspace } from "@/server/people/principals";
import { createStudent, deleteStudent, listStudents } from "@/server/people/students";
import { createTeacher, deleteTeacher } from "@/server/people/teachers";
import { attendanceBySection, classPerformance, principalInsights, teacherOverview } from "@/server/principal/overview";
import { examPerformanceReport } from "@/server/reports/exports";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let principalA: ReturnType<typeof contextFor>;

async function principalOf(school: SeededSchool, key: string) {
  const user = await prisma.user.create({ data: { email: `${key}@principal-test.test`, passwordHash: await hashPassword("SchoolOS@2026"), role: "PRINCIPAL", firstName: "Meera", lastName: "Iyer", schoolId: school.schoolId, activatedAt: new Date() } });
  return { id: user.id, ctx: contextFor(school, user.id, "PRINCIPAL") };
}

const future = () => toDateInput(addDays(today(), 10));

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.user.deleteMany({ where: { email: { contains: "@principal-test.test" } } });
  principalA = (await principalOf(schoolA, "a")).ctx;
}, 60_000);

afterAll(async () => {
  await prisma.teacher.deleteMany({ where: { employeeId: "PRIN-T1" } });
  await prisma.user.deleteMany({ where: { email: { contains: "@principal-test.test" } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the permission table", () => {
  it("makes the Principal a working leader, short of the School Admin", () => {
    for (const area of ["students", "staff", "academics", "attendance", "homework", "exams", "communication", "responsibilities"] as const) {
      expect(can("PRINCIPAL", area, "VIEW")).toBe(true);
      expect(can("PRINCIPAL", area, "CREATE")).toBe(true);
      expect(can("PRINCIPAL", area, "EDIT")).toBe(true);
    }
    expect(can("PRINCIPAL", "exams", "PUBLISH")).toBe(true);
    expect(can("PRINCIPAL", "students", "DELETE")).toBe(false);
    expect(can("PRINCIPAL", "staff", "DELETE")).toBe(false);
    expect(can("PRINCIPAL", "finance", "VIEW")).toBe(true);
    expect(can("PRINCIPAL", "finance", "EDIT")).toBe(false);
    expect(can("PRINCIPAL", "settings", "VIEW")).toBe(false);
    expect(can("PRINCIPAL", "users", "EDIT")).toBe(false);
    expect(can("TEACHER", "responsibilities", "CREATE")).toBe(false);
    expect(can("STUDENT", "finance", "VIEW")).toBe(false);
    expect(ROLE_PERMISSIONS.STUDENT.finance).toBeUndefined();
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.students).toBeUndefined();
    expect(ROLE_PERMISSIONS.TEACHER.attendance?.scope).toBe("ASSIGNED");
  });
});

describe("the Principal works", () => {
  it("reads the dashboard figures and alerts", async () => {
    expect((await classPerformance(principalA, schoolA.academicSessionId)).length).toBeGreaterThan(0);
    await expect(teacherOverview(principalA, schoolA.academicSessionId)).resolves.toBeInstanceOf(Array);
    await expect(attendanceBySection(principalA, schoolA.academicSessionId)).resolves.toBeInstanceOf(Array);
    await expect(principalInsights(principalA, schoolA.academicSessionId)).resolves.toHaveProperty("classTeacherCoverage");
    await expect(academicSnapshot(principalA, schoolA.academicSessionId)).resolves.toHaveProperty("examsInProgress");
    await expect(examPerformanceReport(principalA)).resolves.toBeDefined();
    await expect(financeSnapshot(principalA, schoolA.academicSessionId)).resolves.toHaveProperty("pendingMinor");
    await expect(listFeePositions(principalA)).resolves.toHaveProperty("rows");
    await expect(getPrincipalAlerts(principalA)).resolves.toBeInstanceOf(Array);
    await expect(listStudents(principalA, {})).resolves.toBeDefined();
  });

  it("adds a student and a teacher, audited as the Principal", async () => {
    const admitted = await createStudent(
      principalA,
      createStudentSchema.parse({ firstName: "Kabir", lastName: "Principal-Admit", sectionId: schoolA.sectionId, guardianMode: "new", parentFirstName: "Ravi", parentLastName: "Admit", parentPhone: "+91 90000 22222", relationship: "FATHER" }),
    );
    expect((await prisma.student.findUniqueOrThrow({ where: { id: admitted.studentId } })).schoolId).toBe(schoolA.schoolId);
    const { teacherId } = await createTeacher(principalA, createTeacherSchema.parse({ firstName: "Nisha", lastName: "Hired", employeeId: "PRIN-T1", email: "nisha@principal-test.test" }));
    expect((await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } })).schoolId).toBe(schoolA.schoolId);
    const audit = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, actorId: principalA.user.id }, select: { actorRole: true } });
    expect(audit?.actorRole).toBe("PRINCIPAL");
  });

  it("creates a notice, a PTM and an event, and cancels the PTM", async () => {
    await expect(saveNotice(principalA, noticeSchema.parse({ title: "Uniform reminder", body: "Winter uniform from Monday.", audience: "PARENTS", status: "PUBLISHED" }))).resolves.toEqual(expect.any(String));
    const ptm = await saveMeeting(principalA, meetingSchema.parse({ type: "PTM", title: "Term 1 PTM", date: future(), startMinute: "10:00", endMinute: "12:00", audiences: ["PARENTS"], scope: "SCHOOL" }));
    await cancelMeeting(principalA, { meetingId: ptm, reason: "Rescheduled" });
    await expect(saveEvent(principalA, eventSchema.parse({ title: "Sports Day", date: future(), isPublished: "on" }))).resolves.toEqual(expect.any(String));
  });

  it("schedules an exam, but results stay blocked until every mark is in — for the Principal too", async () => {
    const { ids } = await createExams(
      principalA,
      createExamSchema.parse({ name: "Principal Unit Test", sectionIds: [schoolA.sectionId], startDate: toDateInput(addDays(today(), -3)), endDate: toDateInput(addDays(today(), -2)), papers: [{ subjectId: schoolA.subjectId, maxMarks: "50", passMarks: "" }] }),
    );
    expect(ids).toHaveLength(1);
    expect((await listExams(principalA, { academicSessionId: schoolA.academicSessionId })).some((exam) => exam.id === ids[0])).toBe(true);
    await expect(publishExams(principalA, ids)).rejects.toBeInstanceOf(AppError);
    await expect(publishExams(adminOf(schoolA), ids)).rejects.toBeInstanceOf(AppError);
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: ids[0]! } })).status).toBe("DRAFT");
  });

  it("cannot delete people, take or charge fees, pay salaries, or change access and settings", async () => {
    await expect(deleteStudent(principalA, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteTeacher(principalA, schoolA.teacherId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(principalA, { studentId: schoolA.studentIds[0]!, amountMinor: 100, paidOn: new Date(), method: "CASH", notes: null, receiptNo: "P-1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createFeeHead(principalA, { name: "Nope", note: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payPayroll(principalA, { month: new Date(), paidOn: new Date(), method: "CASH", reference: null, entries: [{ teacherId: schoolA.teacherId, amountMinor: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setStaffGrants(principalA, "any", [])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveAttendanceSettings(principalA, { timing: "FIRST_PERIOD" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPrincipals(principalA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(principalWorkspace(principalA)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the School Admin decides who is Principal", () => {
  it("with no Principal, the workspace is empty and the School Admin carries on", async () => {
    const workspace = await principalWorkspace(adminOf(schoolB));
    expect(workspace.principals).toEqual([]);
    expect(workspace.held).toBeNull();
  });

  it("creates a login waiting for activation, audited; nobody else may", async () => {
    const invite = await createPrincipal(adminOf(schoolA), { firstName: "Asha", lastName: "Rao", email: "asha@principal-test.test", phone: null });
    expect(invite.email).toBe("asha@principal-test.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "asha@principal-test.test" } });
    expect(user).toMatchObject({ role: "PRINCIPAL", schoolId: schoolA.schoolId, activatedAt: null });
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: "PRINCIPAL_CREATED" } })).toBe(1);
    await expect(createPrincipal(adminOf(schoolA), { firstName: "Asha", lastName: "Rao", email: "asha@principal-test.test", phone: null })).rejects.toThrow(/already has a SchoolOS login/);
    await expect(createPrincipal(teacherOf(schoolA), { firstName: "X", lastName: "Y", email: "x@principal-test.test", phone: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPrincipal(principalA, { firstName: "X", lastName: "Y", email: "x@principal-test.test", phone: null })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listPrincipals(adminOf(schoolA))).map((row) => row.email)).toContain("asha@principal-test.test");
    expect((await listPrincipals(adminOf(schoolB))).map((row) => row.email)).not.toContain("asha@principal-test.test");
    // The workspace shows the Principal and their recent actions.
    const workspace = await principalWorkspace(adminOf(schoolA));
    expect(workspace.principals.map((row) => row.id)).toContain(principalA.user.id);
    expect(workspace.activity.length).toBeGreaterThan(0);
  });

  it("a default password must be changed first; changing it lifts the requirement", async () => {
    const { id } = await principalOf(schoolA, "seeded");
    await prisma.user.update({ where: { id }, data: { mustChangePassword: true } });
    const { token } = await createSession(id);
    const user = { ...principalA.user, id, mustChangePassword: true };
    await changePassword(user, token, { currentPassword: "SchoolOS@2026", newPassword: "a-new-and-long-password-1" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).mustChangePassword).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("School B's Principal sees nothing of School A", async () => {
    const principalB = (await principalOf(schoolB, "b")).ctx;
    const classesB = await classPerformance(principalB, schoolB.academicSessionId);
    const classesA = await classPerformance(principalA, schoolA.academicSessionId);
    expect(classesB.some((row) => classesA.some((other) => other.id === row.id))).toBe(false);
    expect(await classPerformance(principalB, schoolA.academicSessionId)).toEqual([]);
    expect(JSON.stringify(await teacherOverview(principalB, schoolB.academicSessionId))).not.toContain(schoolA.teacherId);
    expect(JSON.stringify(await listStudents(principalB, {}))).not.toContain(schoolA.studentIds[0]!);
    await expect(deleteStudent(adminOf(schoolB), schoolA.studentIds[0]!)).rejects.toThrow();
  });
});
