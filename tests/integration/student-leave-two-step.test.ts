/**
 * Leave reaches the people who decide it.
 *
 *   * Staff and teacher leave goes to the School Admin, who sees it on the
 *     sidebar (a badge on Leave) and in Needs action.
 *   * Student leave from a parent goes to the class teacher first. Their
 *     approval sends it to the School Admin; only the admin's approval makes
 *     it leave. The family is told at each step, and sees both steps.
 *   * A teacher's rejection is final unless the admin overturns it; the admin
 *     may also decide before the teacher; the family can cancel while waiting.
 *   * Another school sees none of it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { today } from "@/lib/dates";
import { ConflictError } from "@/lib/errors";
import { adminNav } from "@/lib/nav";
import { leaveRequestSchema } from "@/lib/validation/leave";
import { studentLeaveSchema } from "@/lib/validation/student-leave";
import { getAdminAlerts } from "@/server/alerts/feeds";
import { getRegister } from "@/server/attendance/register";
import { applyStudentLeave, cancelStudentLeave, decideStudentLeave, listStudentLeaves } from "@/server/attendance/student-leave";
import { needsAttention } from "@/server/analytics/today";
import { prisma } from "@/server/db/prisma";
import { getParentAlerts } from "@/server/parent/alerts";
import { applyForLeave, listLeaveRequests } from "@/server/staff/leave";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
const parent = () => contextFor(schoolA, schoolA.parentUserId, "PARENT");
const day = (offset: number) => {
  const date = today();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const ask = (studentIndex: number, offset: number) =>
  applyStudentLeave(parent(), studentLeaveSchema.parse({ studentId: schoolA.studentIds[studentIndex], fromDate: day(offset), toDate: day(offset), reason: "SICK" }));

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // The fixture parent is linked to every School A child.
  const linked = await prisma.parentStudent.count({ where: { parentId: schoolA.parentId } });
  expect(linked).toBeGreaterThanOrEqual(3);
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("staff and teacher leave goes to the School Admin", () => {
  it("a teacher's request waits for the admin, shows on the sidebar and in Needs action", async () => {
    const { id } = await applyForLeave(teacherOf(schoolA), leaveRequestSchema.parse({ type: "SICK", startDate: day(5), endDate: day(5), reason: "Fever" }));
    expect(JSON.stringify(await listLeaveRequests(adminOf(schoolA)))).toContain(id);
    const items = await needsAttention(adminOf(schoolA), { academicSessionId: schoolA.academicSessionId, registersPending: 0, staffMarked: 1, closedToday: false });
    expect(items.find((item) => item.key === "leave")?.count).toBeGreaterThanOrEqual(1);
    expect(adminNav({ leave: 1 }).find((item) => item.href === "/school-admin/leave")?.badge).toBe(1);
    expect(adminNav({ leave: 0 }).find((item) => item.href === "/school-admin/leave")?.badge).toBeUndefined();
  });
});

describe("student leave: class teacher, then the School Admin", () => {
  it("the teacher's approval sends it to the admin; only the admin's makes it leave; the family is told at each step", async () => {
    const { id } = await ask(0, 0);
    await expect(decideStudentLeave(teacherOf(schoolA), { leaveId: id, decision: "APPROVE", comment: "Get well soon" })).resolves.toMatchObject({ status: "TEACHER_APPROVED" });

    const row = (await listStudentLeaves(parent())).find((leave) => leave.id === id)!;
    expect(row.status).toBe("TEACHER_APPROVED");
    expect(row.teacherReview).toMatchObject({ approved: true, comment: "Get well soon" });
    expect((await getParentAlerts(parent())).some((alert) => alert.title.includes("approved by the class teacher") && alert.detail.includes("final approval"))).toBe(true);
    // Not leave yet: nothing on the register.
    expect((await getRegister(teacherOf(schoolA), schoolA.sectionId, today())).rows.find((r) => r.studentId === schoolA.studentIds[0])?.leave).toBeNull();

    // The admin is asked for the final approval.
    expect((await getAdminAlerts(adminOf(schoolA))).some((alert) => alert.href === "/school-admin/student-leave?status=TEACHER_APPROVED")).toBe(true);
    const items = await needsAttention(adminOf(schoolA), { academicSessionId: schoolA.academicSessionId, registersPending: 0, staffMarked: 1, closedToday: false });
    expect(items.find((item) => item.key === "studentLeave")?.count).toBe(1);

    // The admin (principal) can still approve or reject it; the teacher is done.
    expect((await listStudentLeaves(adminOf(schoolA))).find((leave) => leave.id === id)).toMatchObject({ status: "TEACHER_APPROVED", mayDecide: true });
    expect((await listStudentLeaves(teacherOf(schoolA))).find((leave) => leave.id === id)).toMatchObject({ mayDecide: false });

    // The teacher cannot give the final approval.
    await expect(decideStudentLeave(teacherOf(schoolA), { leaveId: id, decision: "APPROVE", comment: null })).rejects.toBeInstanceOf(ConflictError);

    await expect(decideStudentLeave(adminOf(schoolA), { leaveId: id, decision: "APPROVE", comment: "OK" })).resolves.toMatchObject({ status: "APPROVED" });
    expect((await getRegister(teacherOf(schoolA), schoolA.sectionId, today())).rows.find((r) => r.studentId === schoolA.studentIds[0])?.leave).toBe("Sick");
    const done = (await listStudentLeaves(adminOf(schoolA))).find((leave) => leave.id === id)!;
    expect(done).toMatchObject({ status: "APPROVED", decidedByAdmin: true, teacherReview: { approved: true } });
    expect((await getParentAlerts(parent())).some((alert) => alert.title.includes("has been approved"))).toBe(true);
    const audit = await prisma.auditLog.findMany({ where: { schoolId: schoolA.schoolId, entityId: id }, orderBy: { createdAt: "asc" }, select: { action: true } });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(["STUDENT_LEAVE_TEACHER_APPROVED", "STUDENT_LEAVE_APPROVED"]));
  });

  it("the admin may reject a request the class teacher approved", async () => {
    const { id } = await ask(1, 9);
    await decideStudentLeave(teacherOf(schoolA), { leaveId: id, decision: "APPROVE", comment: null });
    await expect(decideStudentLeave(adminOf(schoolA), { leaveId: id, decision: "REJECT", comment: "Annual exam that week" })).resolves.toMatchObject({ status: "REJECTED" });
    const row = (await listStudentLeaves(parent())).find((leave) => leave.id === id)!;
    expect(row).toMatchObject({ status: "REJECTED", decidedByAdmin: true, comment: "Annual exam that week", teacherReview: { approved: true } });
    expect((await getParentAlerts(parent())).some((alert) => alert.title.includes("has been rejected"))).toBe(true);
  });

  it("a teacher's rejection stops it (and is remembered if the admin overturns it)", async () => {
    const { id } = await ask(1, 2);
    await expect(decideStudentLeave(teacherOf(schoolA), { leaveId: id, decision: "REJECT", comment: "Exam day" })).resolves.toMatchObject({ status: "REJECTED" });
    await decideStudentLeave(adminOf(schoolA), { leaveId: id, decision: "APPROVE", comment: "Doctor's note seen" });
    const row = (await listStudentLeaves(adminOf(schoolA))).find((leave) => leave.id === id)!;
    expect(row).toMatchObject({ status: "APPROVED", decidedByAdmin: true, teacherReview: { approved: false, comment: "Exam day" } });
  });

  it("the admin may decide before the teacher; the family may cancel while it waits", async () => {
    const direct = await ask(2, 3);
    await expect(decideStudentLeave(adminOf(schoolA), { leaveId: direct.id, decision: "APPROVE", comment: null })).resolves.toMatchObject({ status: "APPROVED" });
    expect((await listStudentLeaves(adminOf(schoolA))).find((leave) => leave.id === direct.id)?.teacherReview).toBeNull();

    const waiting = await ask(2, 7);
    await decideStudentLeave(teacherOf(schoolA), { leaveId: waiting.id, decision: "APPROVE", comment: null });
    await cancelStudentLeave(parent(), waiting.id);
    expect((await listStudentLeaves(parent())).find((leave) => leave.id === waiting.id)?.status).toBe("CANCELLED");
  });

  it("another school sees none of it", async () => {
    expect(await listStudentLeaves(adminOf(schoolB))).toEqual([]);
    expect((await getAdminAlerts(adminOf(schoolB))).some((alert) => alert.kind.startsWith("student-leave"))).toBe(false);
  });
});
