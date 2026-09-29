/**
 * People lifecycle: JOIN → ACTIVE → status change → access → history kept.
 *
 * Students, guardians, teachers and staff change status without anything
 * being deleted; status and login are separate; leaving closes access at the
 * server whatever the login flag says; and nothing crosses between schools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { staffSchema } from "@/lib/validation/operations";
import { schoolToday } from "@/server/analytics/today";
import { getRegister } from "@/server/attendance/service";
import { createSession, validateSessionToken } from "@/server/auth/session";
import { staffPermissions } from "@/server/auth/staff-access";
import { prisma } from "@/server/db/prisma";
import { grantStaffPortal, saveStaff } from "@/server/operations/staff";
import { findChild, listMyChildren } from "@/server/parent/access";
import { setStudentsStatus } from "@/server/people/bulk-students";
import { changeEmployeeStatus, changeStudentStatus, leavingDates, peopleSummary, personLifecycle, setLoginAccess } from "@/server/people/lifecycle";
import { listParents } from "@/server/people/parents";
import { listStudents } from "@/server/people/students";
import { listTeachers } from "@/server/people/teachers";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const day = (offset = 0) => addDays(today(), offset);
const change = (reason = "Test", confirmReturn = false) => ({ effectiveDate: today(), reason, remarks: null, confirmReturn });
const sessionFor = async (userId: string) => (await createSession(userId)).token;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("a student who leaves", () => {
  it("keeps every record, leaves this year's registers and loses access", async () => {
    const [student] = schoolA.studentIds;
    const token = await sessionFor(schoolA.studentUserId);
    const attendanceBefore = await prisma.studentAttendance.count({ where: { studentId: student } });

    const result = await changeStudentStatus(adminOf(schoolA), student!, "TRANSFERRED", change("Changed school"));
    expect(result).toMatchObject({ from: "ACTIVE", to: "TRANSFERRED", login: "closed" });

    const row = await prisma.student.findUniqueOrThrow({
      where: { id: student },
      select: { status: true, enrollments: { select: { status: true } }, user: { select: { isActive: true, disabledReason: true } } },
    });
    expect(row.status).toBe("TRANSFERRED");
    expect(row.enrollments.map((enrollment) => enrollment.status)).toEqual(["TRANSFERRED"]);
    expect(row.user).toEqual({ isActive: false, disabledReason: "STATUS" });
    // Signed out at once, and history untouched.
    expect(await validateSessionToken(token)).toBeNull();
    expect(await prisma.studentAttendance.count({ where: { studentId: student } })).toBe(attendanceBefore);
    expect(await prisma.parentStudent.count({ where: { studentId: student } })).toBe(1);

    // Off the register a teacher opens today.
    const register = await getRegister(teacherOf(schoolA), schoolA.sectionId, today());
    expect(JSON.stringify(register)).not.toContain(student);

    // Recorded with its date and reason, status and login separately.
    const info = await personLifecycle(adminOf(schoolA), "STUDENT", student!);
    expect(info).toMatchObject({ status: "TRANSFERRED", login: "LOCKED" });
    expect(info.leftOn?.getTime()).toBe(today().getTime());
    expect(info.history.map((entry) => `${entry.kind}:${entry.from}->${entry.to}`).sort()).toEqual(["LOGIN:ACTIVE->LOCKED", "STATUS:ACTIVE->TRANSFERRED"]);
    expect(await prisma.auditLog.count({ where: { schoolId: schoolA.schoolId, action: "PERSON_STATUS_CHANGED", entityId: student } })).toBe(1);
  });

  it("drops out of the default list but stays searchable, with the leaving date", async () => {
    const [student] = schoolA.studentIds;
    const current = await listStudents(adminOf(schoolA), { status: "CURRENT" });
    expect(current.rows.map((row) => row.id)).not.toContain(student);
    const all = await listStudents(adminOf(schoolA), { q: "Aarav" });
    expect(all.rows.map((row) => row.id)).toContain(student);
    const dates = await leavingDates(adminOf(schoolA), "STUDENT", all.rows);
    expect(dates.get(student!)?.getTime()).toBe(today().getTime());
  });

  it("refuses a login while the status forbids it, a future date, and a silent return", async () => {
    const [student] = schoolA.studentIds;
    await expect(setLoginAccess(adminOf(schoolA), { person: "STUDENT", personId: student!, enabled: true, reason: null })).rejects.toBeInstanceOf(ConflictError);
    await expect(changeStudentStatus(adminOf(schoolA), schoolA.studentIds[1]!, "WITHDRAWN", { ...change(), effectiveDate: day(3) })).rejects.toBeInstanceOf(ValidationError);
    await expect(changeStudentStatus(adminOf(schoolA), student!, "ACTIVE", change())).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns with the login reopened and back on this year's register", async () => {
    const [student] = schoolA.studentIds;
    const result = await changeStudentStatus(adminOf(schoolA), student!, "ACTIVE", change("Rejoined", true));
    expect(result.login).toBe("reopened");
    const row = await prisma.student.findUniqueOrThrow({ where: { id: student }, select: { enrollments: { select: { status: true } }, user: { select: { isActive: true } } } });
    expect(row.enrollments[0]?.status).toBe("ACTIVE");
    expect(row.user?.isActive).toBe(true);
    expect(await validateSessionToken(await sessionFor(schoolA.studentUserId))).not.toBeNull();
  });

  it("keeps a login the office closed on purpose closed, even after a return", async () => {
    const [student] = schoolA.studentIds;
    await setLoginAccess(adminOf(schoolA), { person: "STUDENT", personId: student!, enabled: false, reason: "Misuse" });
    expect((await personLifecycle(adminOf(schoolA), "STUDENT", student!)).login).toBe("DISABLED");
    await changeStudentStatus(adminOf(schoolA), student!, "ON_LEAVE", change());
    await changeStudentStatus(adminOf(schoolA), student!, "ACTIVE", change());
    expect((await personLifecycle(adminOf(schoolA), "STUDENT", student!)).login).toBe("DISABLED");
    await setLoginAccess(adminOf(schoolA), { person: "STUDENT", personId: student!, enabled: true, reason: null });
    expect((await personLifecycle(adminOf(schoolA), "STUDENT", student!)).login).toBe("ACTIVE");
  });

  it("is refused at the session even if the login flag were left open", async () => {
    const [student] = schoolA.studentIds;
    const token = await sessionFor(schoolA.studentUserId);
    await prisma.student.update({ where: { id: student }, data: { status: "GRADUATED" } });
    expect(await validateSessionToken(token)).toBeNull();
    await prisma.student.update({ where: { id: student }, data: { status: "ACTIVE" } });
    expect(await validateSessionToken(token)).not.toBeNull();
  });
});

describe("guardians", () => {
  it("keep full access to children still here when one child leaves", async () => {
    const [first, second] = schoolA.studentIds;
    await changeStudentStatus(adminOf(schoolA), second!, "TRANSFERRED", change());
    const { children } = await listMyChildren(parentOf(schoolA));
    expect(children.find((child) => child.id === second)).toMatchObject({ current: false, sectionId: null });
    expect(children.find((child) => child.id === first)).toMatchObject({ current: true });
    await expect(findChild(parentOf(schoolA), second!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(findChild(parentOf(schoolA), first!)).resolves.toBeTruthy();
    expect(await validateSessionToken(await sessionFor(schoolA.parentUserId))).not.toBeNull();
    const active = await listParents(adminOf(schoolA), { standing: "ACTIVE" });
    expect(active.rows.find((row) => row.id === schoolA.parentId)?.standing).toBe("ACTIVE");
  });

  it("move to NO_ACTIVE_CHILDREN when every child has left, keeping their login and links", async () => {
    const [first, , third] = schoolA.studentIds;
    await changeStudentStatus(adminOf(schoolA), first!, "GRADUATED", change());
    await changeStudentStatus(adminOf(schoolA), third!, "WITHDRAWN", change());
    const none = await listParents(adminOf(schoolA), { standing: "NO_ACTIVE_CHILDREN" });
    expect(none.rows.find((row) => row.id === schoolA.parentId)?.standing).toBe("NO_ACTIVE_CHILDREN");
    expect((await listParents(adminOf(schoolA), { standing: "ACTIVE" })).rows.map((row) => row.id)).not.toContain(schoolA.parentId);
    expect(await validateSessionToken(await sessionFor(schoolA.parentUserId))).not.toBeNull();
    expect(await prisma.parentStudent.count({ where: { parentId: schoolA.parentId } })).toBe(3);
    expect((await listMyChildren(parentOf(schoolA))).children.every((child) => !child.current)).toBe(true);

    // Everyone back, through the bulk action — which records each change too.
    await setStudentsStatus(adminOf(schoolA), { status: "ACTIVE", studentIds: schoolA.studentIds });
    expect(await prisma.statusChange.count({ where: { studentId: { in: schoolA.studentIds }, kind: "STATUS", reason: "Bulk status change" } })).toBe(3);
  });
});

describe("a teacher who leaves", () => {
  it("loses the login and the class-teachership, and every record stays theirs", async () => {
    const token = await sessionFor(schoolA.teacherUserId);
    const result = await changeEmployeeStatus(adminOf(schoolA), "TEACHER", schoolA.teacherId, "RESIGNED", change("Resignation"));
    expect(result.login).toBe("closed");
    expect(result.handover).toMatchObject({ classTeacherRemoved: 1, subjects: 1 });
    expect(await validateSessionToken(token)).toBeNull();

    const section = await prisma.section.findUniqueOrThrow({ where: { id: schoolA.sectionId }, select: { classTeacherId: true } });
    expect(section.classTeacherId).toBeNull();
    // The year's record of who taught what is kept as it was.
    expect(await prisma.teacherSubjectAssignment.count({ where: { teacherId: schoolA.teacherId } })).toBe(1);
    const history = await prisma.classTeacherAssignment.findMany({ where: { teacherId: schoolA.teacherId }, select: { toDate: true } });
    expect(history.every((row) => row.toDate !== null)).toBe(true);

    // Default list: current teachers only; former ones still findable.
    expect((await listTeachers(adminOf(schoolA), { status: "CURRENT" })).rows.map((row) => row.id)).not.toContain(schoolA.teacherId);
    expect((await listTeachers(adminOf(schoolA), {})).rows.map((row) => row.id)).toContain(schoolA.teacherId);
  });

  it("can be suspended without leaving, and comes back only when meant", async () => {
    await expect(changeEmployeeStatus(adminOf(schoolA), "TEACHER", schoolA.teacherId, "ACTIVE", change())).rejects.toBeInstanceOf(ValidationError);
    await changeEmployeeStatus(adminOf(schoolA), "TEACHER", schoolA.teacherId, "ACTIVE", change("Rehired", true));
    expect(await validateSessionToken(await sessionFor(schoolA.teacherUserId))).not.toBeNull();

    const suspended = await changeEmployeeStatus(adminOf(schoolA), "TEACHER", schoolA.teacherId, "SUSPENDED", change());
    expect(suspended.login).toBe("closed");
    expect(suspended.handover).toBeUndefined();
    await changeEmployeeStatus(adminOf(schoolA), "TEACHER", schoolA.teacherId, "ACTIVE", change());
  });
});

describe("non-teaching staff who leave", () => {
  it("lose the login, their permissions and their bus route, and stay on record", async () => {
    const ctx = adminOf(schoolA);
    const staffId = await saveStaff(ctx, staffSchema.parse({ employeeId: "LC-1", firstName: "Ramesh", lastName: "Driver", role: "DRIVER", permissions: ["VIEW_TRANSPORT"] }));
    const { password } = await grantStaffPortal(ctx, staffId, "lc-driver@iso-test-staff.test");
    expect(password).toBeTruthy();
    const route = await prisma.transportRoute.create({ data: { schoolId: schoolA.schoolId, name: "Route LC", driverId: staffId } });
    const user = await prisma.staffMember.findUniqueOrThrow({ where: { id: staffId }, select: { userId: true } });
    const staffCtx = contextFor(schoolA, user.userId!, "NON_TEACHING_STAFF");
    const before = await schoolToday(ctx, schoolA.academicSessionId);

    const result = await changeEmployeeStatus(ctx, "STAFF", staffId, "RESIGNED", change());
    expect(result).toMatchObject({ login: "closed", handover: { routesCleared: 1 } });
    expect(await staffPermissions(staffCtx)).toEqual([]);
    expect((await prisma.transportRoute.findUniqueOrThrow({ where: { id: route.id } })).driverId).toBeNull();
    expect(await prisma.staffMember.count({ where: { id: staffId } })).toBe(1);
    // Counts describe the school today, not everyone ever employed.
    expect((await schoolToday(ctx, schoolA.academicSessionId)).staff).toBe(before.staff - 1);
    const summary = await peopleSummary(ctx);
    expect(summary.staff.former).toBeGreaterThanOrEqual(1);
  });

  it("records a status sent with the edit form or the API like any other change", async () => {
    const ctx = adminOf(schoolA);
    const staffId = await saveStaff(ctx, staffSchema.parse({ employeeId: "LC-2", firstName: "Sita", lastName: "Office", role: "RECEPTIONIST" }));
    await saveStaff(ctx, staffSchema.parse({ staffId, employeeId: "LC-2", firstName: "Sita", lastName: "Office", role: "RECEPTIONIST", status: "RETIRED" }));
    const info = await personLifecycle(ctx, "STAFF", staffId);
    expect(info.status).toBe("RETIRED");
    expect(info.history[0]).toMatchObject({ kind: "STATUS", from: "ACTIVE", to: "RETIRED" });
  });
});

describe("who may do this", () => {
  it("is the School Admin of the same school only", async () => {
    const student = schoolA.studentIds[2]!;
    await expect(changeStudentStatus(adminOf(schoolB), student, "TRANSFERRED", change())).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeEmployeeStatus(adminOf(schoolB), "TEACHER", schoolA.teacherId, "RESIGNED", change())).rejects.toBeInstanceOf(NotFoundError);
    await expect(setLoginAccess(adminOf(schoolB), { person: "PARENT", personId: schoolA.parentId, enabled: false, reason: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(personLifecycle(adminOf(schoolB), "STUDENT", student)).rejects.toBeInstanceOf(NotFoundError);

    await expect(changeStudentStatus(teacherOf(schoolA), student, "TRANSFERRED", change())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setLoginAccess(parentOf(schoolA), { person: "STUDENT", personId: student, enabled: false, reason: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeEmployeeStatus(contextFor(schoolA, schoolA.studentUserId, "STUDENT"), "TEACHER", schoolA.teacherId, "RESIGNED", change())).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: student } })).status).toBe("ACTIVE");
  });

  it("cannot record a status change against another school's person even bypassing the service", async () => {
    await expect(
      prisma.statusChange.create({
        data: { schoolId: schoolA.schoolId, person: "STUDENT", kind: "STATUS", studentId: schoolB.studentIds[0]!, fromValue: "ACTIVE", toValue: "TRANSFERRED", effectiveDate: day() },
      }),
    ).rejects.toThrow();
    // …nor one naming nobody, or two people at once.
    await expect(
      prisma.statusChange.create({ data: { schoolId: schoolA.schoolId, person: "STUDENT", kind: "STATUS", fromValue: "A", toValue: "B", effectiveDate: day() } }),
    ).rejects.toThrow();
    expect(toDateInput(day())).toBeTruthy();
  });
});
